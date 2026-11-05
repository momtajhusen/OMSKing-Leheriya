const Order = require('../models/Order');
const Shipment = require('../models/Shipment');
const { HttpError } = require('../utils/httpError');
const { getConnection, credsOf } = require('./channelConnection.service');
const { orderPackage } = require('./packageDefaults.service');
const { labelPdfFrom } = require('../lib/zipRead');
const amazon = require('../adapters/amazon');

const COURIER = 'Amazon Easy Ship';
const BULK_MAX = 50;

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

function refuse(message) {
  const err = new HttpError(400, message);
  err.terminal = true;
  return err;
}

/** One Easy Ship session (one Amazon token) per click or batch, opened only when Amazon is really needed. */
function lazySession(tenantId, deps) {
  let opened = null;
  return () => {
    opened = opened || (async () => {
      const creds = deps.amazonCreds || credsOf(await getConnection(tenantId, 'amazon'));
      return amazon.easyShip(creds, { request: deps.amazonRequest, download: deps.amazonDownload });
    })();
    return opened;
  };
}

async function amazonOrder(tenantId, orderNo) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (String(order.channel).toLowerCase() !== 'amazon') throw refuse(`${order.channel} is not an Amazon order. Easy Ship was not called.`);
  return order;
}

const bookedLabel = (tenantId, orderNo) => skip(Shipment.findOne({ tenantId, orderNo, status: 'booked', courier: 'amazon' }));

async function labelOne(tenantId, order, session) {
  const existing = await bookedLabel(tenantId, order.orderNo);
  if (existing) return existing;
  const pack = await orderPackage(tenantId, order.items || []);
  if (!(pack.weightGrams > 0 && pack.lengthCm > 0 && pack.breadthCm > 0 && pack.heightCm > 0)) {
    throw refuse('Package weight and size are missing for this order. Set them on the order items or in Settings › Package defaults. Amazon was not called.');
  }
  const easy = await session();
  const amazonOrderId = order.externalOrderId || order.orderNo;
  const slots = await easy.slots(amazonOrderId, pack);
  if (!slots.length) throw refuse('Amazon has no Easy Ship pickup slot for this order right now. Try again later.');
  const { slotId } = slots[0];
  const scheduled = await easy.schedule(amazonOrderId, slotId);
  let pkg = scheduled.pkg;
  let labelPdf = null;
  if (pkg) {
    if (scheduled.documentsUrl) labelPdf = labelPdfFrom(await easy.label(scheduled.documentsUrl));
  } else {
    const known = await easy.find(amazonOrderId);
    if (!known) throw refuse(`Amazon refused the Easy Ship label: ${scheduled.rejected}`);
    if (known.pickedUp) throw refuse(`Amazon already picked up this package (${known.status}). A new label cannot be made.`);
    const moved = await easy.reschedule(amazonOrderId, known.packageId, slotId);
    pkg = { ...known, ...(moved || {}), trackingId: moved?.trackingId || known.trackingId };
    const earlier = await skip(Shipment.findOne({
      tenantId, orderNo: order.orderNo, courier: 'amazon', channelPackageId: known.packageId, labelPdf: { $ne: null },
    }).sort({ createdAt: -1 }));
    labelPdf = earlier?.labelPdf || null;
  }
  if (!pkg.trackingId) throw refuse('Amazon scheduled the package but sent no tracking id. Nothing was saved.');
  const shipment = await Shipment.create({
    tenantId,
    orderNo: order.orderNo,
    channel: 'amazon',
    courier: 'amazon',
    awb: pkg.trackingId,
    status: 'booked',
    warehouseCode: 'WH-001',
    labelPdf,
    channelPackageId: pkg.packageId,
    bookedAt: new Date(),
  });
  order.awb = pkg.trackingId;
  order.courier = COURIER;
  order.labelGeneratedAt = new Date();
  order.easyShip = {
    packageId: pkg.packageId,
    status: pkg.status,
    slotStart: pkg.slot?.start ? new Date(pkg.slot.start) : null,
    slotEnd: pkg.slot?.end ? new Date(pkg.slot.end) : null,
    handover: pkg.slot?.handover || '',
  };
  await order.save();
  return shipment;
}

/** Easy Ship label for one Amazon order: first pickup slot, package, AWB, label PDF; the order stays open until pickup. */
async function amazonEasyShipLabel(tenantId, orderNo, deps = {}) {
  const order = await amazonOrder(tenantId, orderNo);
  return labelOne(tenantId, order, lazySession(tenantId, deps));
}

/** Labels for many Amazon orders on one token; each order succeeds or fails on its own. */
async function amazonBulkLabels(tenantId, orderNos, deps = {}) {
  const ids = [...new Set((orderNos || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, 'Choose at least one Amazon order.');
  if (ids.length > BULK_MAX) throw new HttpError(400, `Choose at most ${BULK_MAX} Amazon orders at a time.`);
  const session = lazySession(tenantId, deps);
  const done = [];
  const failed = [];
  for (const orderNo of ids) {
    try {
      const shipment = await labelOne(tenantId, await amazonOrder(tenantId, orderNo), session);
      done.push({ orderNo, awb: shipment.awb, label: Boolean(shipment.labelPdf) });
    } catch (err) {
      failed.push({ orderNo, reason: err.message });
    }
  }
  return { done, failed };
}

/**
 * Easy Ship has no cancel call: OMSKing drops the label and AWB, and keeps the Amazon package id so the next label
 * moves that same package to a new pickup slot instead of making a second one.
 */
async function cancelAmazonLabel(tenantId, orderNo) {
  const order = await amazonOrder(tenantId, orderNo);
  if (['Dispatched', 'Delivered'].includes(order.status)) throw refuse('Amazon already picked up this order. The label cannot be cancelled.');
  const shipment = await bookedLabel(tenantId, order.orderNo);
  if (!shipment) throw new HttpError(400, 'This order has no Amazon label to cancel.');
  shipment.status = 'cancelled';
  shipment.cancelledAt = new Date();
  await shipment.save();
  order.awb = '';
  order.labelGeneratedAt = null;
  order.handoverAt = null;
  order.manifestNo = '';
  order.pickedUpAt = null;
  await order.save();
  return shipment;
}

/** The stored Easy Ship label PDF for a reprint; Amazon is not called. */
async function amazonLabelPdf(tenantId, orderNo) {
  const order = await amazonOrder(tenantId, orderNo);
  const shipment = await bookedLabel(tenantId, order.orderNo);
  if (!shipment) throw new HttpError(404, 'This order has no Amazon label yet.');
  if (!shipment.labelPdf) throw new HttpError(404, 'Amazon did not send a label PDF for this package. Print it from Seller Central.');
  return shipment.labelPdf;
}

module.exports = { amazonEasyShipLabel, amazonBulkLabels, cancelAmazonLabel, amazonLabelPdf, COURIER };
