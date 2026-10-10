const Order = require('../models/Order');
const Shipment = require('../models/Shipment');
const Warehouse = require('../models/Warehouse');
const InventoryReservation = require('../models/InventoryReservation');
const { HttpError } = require('../utils/httpError');
const { getConnection, credsOf } = require('./channelConnection.service');
const { releaseReservation } = require('./inventory.service');
const { enqueue } = require('./jobQueue.service');
const { bookPaymentMode } = require('./orderDesk.service');
const delhivery = require('../adapters/couriers/delhivery');
const shopify = require('../adapters/shopify');
const amazon = require('../adapters/amazon');
const myntra = require('../adapters/myntra');

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

function pinOf(order) {
  const match = `${order.city || ''} ${order.address || ''}`.match(/\b(\d{6})\b/);
  return match ? match[1] : '';
}

function cityOf(order) {
  return String(order.city || '').replace(/\b\d{6}\b/, '').replace(/,/g, ' ').trim() || 'City';
}

async function delhiveryCreds(tenantId) {
  const { activeCourierCreds } = require('./courierAccount.service');
  return activeCourierCreds(tenantId, 'delhivery');
}

async function pickupWarehouse(tenantId) {
  const row = await skip(Warehouse.findOne({ tenantId, code: 'WH-001', status: 'active' }));
  if (!row) {
    const err = new HttpError(400, 'WH-001 is missing. Delhivery pickup was not booked.');
    err.terminal = true;
    throw err;
  }
  const address = [row.address?.line1, row.address?.city, row.address?.pincode].filter(Boolean).join(', ');
  if (!row.address?.line1 || !row.address?.pincode || !row.contactPhone) {
    const err = new HttpError(400, 'WH-001 needs a street address, pincode, and phone before an AWB is booked.');
    err.terminal = true;
    throw err;
  }
  return { address, phone: row.contactPhone };
}

async function saveShipment(doc) {
  return Shipment.create(doc);
}

async function bookShopify(tenantId, orderNo, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (String(order.channel).toLowerCase() !== 'shopify') {
    const err = new HttpError(400, `${order.channel} uses the marketplace courier. Delhivery was not called.`);
    err.terminal = true;
    throw err;
  }
  const existing = await skip(Shipment.findOne({ tenantId, orderNo, status: 'booked' }));
  if (existing?.shopifyFulfillmentId) return existing;

  const creds = deps.delhiveryCreds || await delhiveryCreds(tenantId);
  const shopCreds = deps.shopifyCreds || credsOf(await getConnection(tenantId, 'shopify'));
  if (!String(shopCreds?.shopUrl || shopCreds?.shop || '').trim() || !String(shopCreds?.adminToken || '').trim()) {
    const err = new HttpError(400, 'Shopify shop URL and admin token are missing. Delhivery was not called.');
    err.terminal = true;
    throw err;
  }
  const pay = bookPaymentMode(order.paymentMode);
  if (pay === 'Void') {
    const err = new HttpError(400, 'This payment is Void. Delhivery was not called, and it is not booked as COD.');
    err.terminal = true;
    throw err;
  }
  const request = deps.delhiveryRequest;
  let shipment = existing;
  if (!shipment?.awb) {
    const pickup = await pickupWarehouse(tenantId);
    const pincode = pinOf(order);
    await delhivery.serviceable(creds, { pincode, paymentMode: pay, request });
    const booked = await delhivery.book(creds, {
      name: order.customer || 'Customer',
      address: order.address || order.city,
      pincode,
      city: cityOf(order),
      state: '',
      phone: order.phone || pickup.phone,
      orderNo: order.orderNo,
      paymentMode: pay,
      description: (order.items || []).map((item) => item.name || item.sku).filter(Boolean).join(', ') || order.orderNo,
      quantity: (order.items || []).reduce((sum, item) => sum + (Number(item.qty) || 1), 0) || 1,
      amount: order.total || 0,
      pickupAddress: pickup.address,
    }, { request });
    const label = await delhivery.labelPdf(creds, booked.awb, { request });
    shipment = await saveShipment({
      tenantId,
      orderNo: order.orderNo,
      channel: 'shopify',
      courier: 'delhivery',
      awb: booked.awb,
      status: 'booked',
      warehouseCode: 'WH-001',
      labelPdf: label,
      bookedAt: new Date(),
    });
  }
  const fulfilled = await shopify.fulfillOrder(shopCreds, {
    orderId: order.externalOrderId || order.orderNo,
    trackingNumber: shipment.awb,
    request: deps.shopifyRequest,
  });
  shipment.shopifyFulfillmentId = fulfilled.fulfillmentId;
  await shipment.save();
  order.awb = shipment.awb;
  order.courier = 'Delhivery';
  order.status = 'Dispatched';
  order.labelGeneratedAt = new Date();
  await order.save();
  return shipment;
}

async function cancelShopifyLabel(tenantId, orderNo, { releaseReserve = false, deps = {} } = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  const shipment = await skip(Shipment.findOne({ tenantId, orderNo, status: 'booked', courier: 'delhivery' }));
  if (!shipment) throw new HttpError(400, 'This order has no Delhivery AWB to cancel.');
  const creds = deps.delhiveryCreds || await delhiveryCreds(tenantId);
  await delhivery.cancelAwb(creds, shipment.awb, { request: deps.delhiveryRequest });
  if (shipment.shopifyFulfillmentId) {
    const shopCreds = deps.shopifyCreds || credsOf(await getConnection(tenantId, 'shopify'));
    await shopify.cancelFulfillment(shopCreds, {
      fulfillmentId: shipment.shopifyFulfillmentId,
      request: deps.shopifyRequest,
    });
  }
  shipment.status = 'cancelled';
  shipment.cancelledAt = new Date();
  if (releaseReserve) {
    await releaseHeld(tenantId, order);
    shipment.reserveReleased = true;
  }
  await shipment.save();
  order.awb = '';
  order.labelGeneratedAt = null;
  order.status = 'New';
  await order.save();
  return shipment;
}

async function releaseHeld(tenantId, order) {
  const refs = [order.orderNo, ...(order.subOrders || []).map((sub) => sub.id), ...(order.subOrders || []).map((sub) => `${order.orderNo}:${sub.id}`)];
  const holds = await skip(InventoryReservation.find({ tenantId, status: 'held', orderRef: { $in: refs } }));
  for (const hold of holds) {
    await releaseReservation(tenantId, null, { idempotencyKey: hold.idempotencyKey, reason: 'Order cancelled with the label' });
  }
}

async function bookMarketplace(tenantId, orderNo, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  const channel = String(order.channel || '').toLowerCase();
  if (channel === 'shopify') {
    const err = new HttpError(400, 'Shopify ships on Delhivery. The marketplace ship API was not called.');
    err.terminal = true;
    throw err;
  }
  const existing = await skip(Shipment.findOne({ tenantId, orderNo, status: 'booked' }));
  if (existing) return existing;
  let shipped;
  if (channel === 'amazon') {
    const creds = deps.amazonCreds || credsOf(await getConnection(tenantId, 'amazon'));
    shipped = await amazon.confirmShipment(creds, {
      amazonOrderId: order.externalOrderId || order.orderNo,
      request: deps.amazonRequest,
    });
  } else if (channel === 'myntra') {
    const creds = deps.myntraCreds || credsOf(await getConnection(tenantId, 'myntra'));
    const line = (order.channelLines || [])[0] || {};
    shipped = await myntra.shipOrder(creds, {
      sellerOrderId: line.sellerOrderId || order.externalOrderId,
      packetId: line.packetId || '',
      client: deps.myntraClient,
    });
  } else {
    throw new HttpError(400, `${order.channel} has no ship API.`);
  }
  const shipment = await saveShipment({
    tenantId,
    orderNo: order.orderNo,
    channel,
    courier: shipped.courier,
    awb: shipped.trackingNumber,
    status: 'booked',
    warehouseCode: 'WH-001',
    bookedAt: new Date(),
  });
  order.awb = shipped.trackingNumber;
  order.courier = shipped.courier;
  order.status = 'Dispatched';
  order.labelGeneratedAt = new Date();
  await order.save();
  return shipment;
}

async function releaseVendorSlice(tenantId, order, sub) {
  const refs = [sub.id, `${order.orderNo}:${sub.id}`];
  if ((order.subOrders || []).length <= 1) refs.push(order.orderNo);
  const filter = { tenantId, status: 'held', orderRef: { $in: refs } };
  if (sub.masterSkuId) filter.masterSkuId = sub.masterSkuId;
  const holds = await skip(InventoryReservation.find(filter));
  for (const hold of holds) {
    await releaseReservation(tenantId, null, { idempotencyKey: hold.idempotencyKey, reason: 'Vendor rejected the line' });
  }
  return holds.length;
}

async function queueBulkLabels(tenantId, userId, orderNos) {
  const ids = [...new Set((orderNos || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, 'Choose at least one Shopify order.');
  return enqueue({
    tenantId,
    channel: 'shopify',
    jobType: 'shipment_push',
    triggeredBy: 'manual',
    triggeredByUserId: userId,
    payload: { orderNos: ids },
  });
}

function kolkataDayStart(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${day}T00:00:00+05:45`);
}

async function markPickedUp(rows) {
  if (!rows.length) return;
  await Shipment.updateMany(
    { _id: { $in: rows.map((row) => row._id) } },
    { $set: { pickupRequestedAt: new Date() } },
  ).setOptions({ skipTenantFilter: true });
}

async function closeDayManifest(tenantId, deps = {}) {
  const start = kolkataDayStart();
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const rows = await skip(Shipment.find({
    tenantId,
    courier: 'delhivery',
    status: 'booked',
    warehouseCode: 'WH-001',
    pickupRequestedAt: null,
    bookedAt: { $gte: start, $lt: end },
  }));
  if (!rows.length) {
    throw new HttpError(400, 'No Delhivery AWBs are waiting for today\'s WH-001 pickup.');
  }
  const creds = deps.delhiveryCreds || await delhiveryCreds(tenantId);
  await delhivery.requestPickup(creds, { count: rows.length, request: deps.delhiveryRequest });
  await markPickedUp(rows);
  return {
    count: rows.length,
    warehouseCode: 'WH-001',
    rows: rows.map((row) => ({
      orderNo: row.orderNo,
      awb: row.awb,
      courier: row.courier,
      warehouseCode: row.warehouseCode || 'WH-001',
    })),
  };
}

async function shippingReadiness(tenantId) {
  const missing = [];
  const creds = await delhiveryCreds(tenantId);
  const courierReady = Boolean(String(creds?.apiToken || '').trim());
  if (!courierReady) missing.push('Delhivery API token on this company');
  const row = await skip(Warehouse.findOne({ tenantId, code: 'WH-001', status: 'active' }));
  if (!row?.address?.line1) missing.push('WH-001 street address');
  if (!row?.address?.pincode) missing.push('WH-001 pincode');
  if (!row?.contactPhone) missing.push('WH-001 phone');
  return {
    courierName: courierReady ? 'Delhivery' : '',
    courierReady,
    warehouseReady: Boolean(row?.address?.line1 && row?.address?.pincode && row?.contactPhone),
    missing,
  };
}

async function runShipmentJob(job, deps = {}) {
  const orderNos = job.payload?.orderNos || [];
  const booked = [];
  for (const orderNo of orderNos) {
    booked.push(await bookShopify(job.tenantId, orderNo, { ...deps, skipPickup: true }));
  }
  const waiting = booked.filter((row) => !row.pickupRequestedAt);
  if (waiting.length) {
    const creds = deps.delhiveryCreds || await delhiveryCreds(job.tenantId);
    await delhivery.requestPickup(creds, { count: waiting.length, request: deps.delhiveryRequest });
    await markPickedUp(waiting);
  }
  return { booked: booked.length, pickup: waiting.length };
}

module.exports = {
  bookShopify,
  cancelShopifyLabel,
  bookMarketplace,
  releaseVendorSlice,
  releaseOrderReserve: releaseHeld,
  queueBulkLabels,
  closeDayManifest,
  runShipmentJob,
  shippingReadiness,
};
