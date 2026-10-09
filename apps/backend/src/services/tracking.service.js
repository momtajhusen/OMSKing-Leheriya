const Order = require('../models/Order');
const Shipment = require('../models/Shipment');
const NdrCase = require('../models/NdrCase');
const { HttpError } = require('../utils/httpError');
const delhivery = require('../adapters/couriers/delhivery');

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

const ORDER_STATUS = {
  picked_up: 'Dispatched',
  in_transit: 'Dispatched',
  out_for_delivery: 'Dispatched',
  delivered: 'Delivered',
};

async function orderCount(tenantId) {
  return Order.countDocuments({ tenantId });
}

async function applyTracking(tenantId, { orderNo, awb, status, detail, attempt, eventKey } = {}, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  const orderId = String(order._id);
  const before = await orderCount(tenantId);
  const waybill = String(awb || order.awb || '').trim();
  let shipment = waybill
    ? await skip(Shipment.findOne({ tenantId, awb: waybill, status: 'booked' }))
    : null;
  if (!shipment) shipment = await skip(Shipment.findOne({ tenantId, orderNo, status: 'booked' }));
  if (!shipment) {
    shipment = await Shipment.create({
      tenantId,
      orderNo,
      channel: String(order.channel || '').toLowerCase() || 'shopify',
      courier: String(order.courier || 'delhivery').toLowerCase(),
      awb: waybill,
      status: 'booked',
      trackingEvents: [],
    });
  }
  const key = eventKey || `${waybill}:${status}:${detail || ''}:${attempt || 0}`;
  if ((shipment.trackingEvents || []).some((row) => row.eventKey === key)) {
    return { order, shipment, duplicate: true, orderCount: before, orderId };
  }
  shipment.trackingEvents.push({
    status,
    detail: detail || '',
    attempt: Number(attempt) || 0,
    eventKey: key,
    at: new Date(),
  });
  shipment.deliveryStatus = status;
  await shipment.save();

  if (status === 'ndr') {
    await NdrCase.findOneAndUpdate(
      { tenantId, orderNo },
      {
        $set: {
          awb: waybill,
          reason: detail || 'Delivery attempt failed',
          attempt: Number(attempt) || 1,
          status: 'open',
        },
        $setOnInsert: { tenantId, orderNo },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).setOptions({ skipTenantFilter: true });
  } else if (status === 'rto') {
    order.channelStatus = 'RTO';
    const { restockRtoOnce } = require('./orderReserve.service');
    await restockRtoOnce(tenantId, order);
    await order.save();
    await NdrCase.updateOne(
      { tenantId, orderNo },
      { $set: { status: 'rto', awb: waybill } },
    ).setOptions({ skipTenantFilter: true });
  } else if (ORDER_STATUS[status]) {
    order.status = ORDER_STATUS[status];
    if (waybill) order.awb = waybill;
    await order.save();
    const { notifyEventEmail } = require('./notify.service');
    if (ORDER_STATUS[status] === 'Delivered') {
      await notifyEventEmail(tenantId, 'NOT-005', {
        dedupeKey: `delivered:${order.orderNo}`,
        subject: `Delivered ${order.orderNo}`,
        text: `Order: ${order.orderNo}\nStatus: Delivered`,
      }, deps);
    } else {
      await notifyEventEmail(tenantId, 'NOT-004', {
        dedupeKey: `shipping:${order.orderNo}:${status}`,
        subject: `Shipping ${order.orderNo}`,
        text: `Order: ${order.orderNo}\nStatus: Dispatched`,
      }, deps);
    }
  }

  const after = await orderCount(tenantId);
  if (String(order._id) !== orderId || after !== before) {
    throw new HttpError(500, 'Tracking changed the Master Order identity.');
  }
  return { order, shipment, duplicate: false, orderCount: after, orderId };
}

async function pollDelhivery(tenantId, orderNo, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (String(order.channel || '').toLowerCase() !== 'shopify' && String(order.courier || '').toLowerCase() !== 'delhivery') {
    const err = new HttpError(400, `${order.channel} tracking stays on the marketplace. Delhivery was not called.`);
    err.terminal = true;
    throw err;
  }
  const { activeCourierCreds } = require('./courierAccount.service');
  const creds = deps.delhiveryCreds || await activeCourierCreds(tenantId, 'delhivery');
  const events = await delhivery.trackShipment(creds, order.awb, { request: deps.delhiveryRequest });
  const applied = [];
  for (const event of events) {
    applied.push(await applyTracking(tenantId, { orderNo, awb: order.awb, ...event }, deps));
  }
  return { orderNo, applied: applied.length };
}

async function reattemptNdr(tenantId, orderNo, { phone, address, deps = {} } = {}) {
  const before = await orderCount(tenantId);
  const ndr = await skip(NdrCase.findOne({ tenantId, orderNo }));
  if (!ndr) throw new HttpError(404, 'No NDR is open for this order');
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (phone) ndr.phone = String(phone).trim();
  if (address) ndr.address = String(address).trim();
  const { activeCourierCreds } = require('./courierAccount.service');
  const creds = deps.delhiveryCreds || await activeCourierCreds(tenantId, 'delhivery');
  await delhivery.ndrAction(creds, {
    awb: ndr.awb || order.awb,
    act: 'RE-ATTEMPT',
    phone: ndr.phone,
    address: ndr.address,
  }, { request: deps.delhiveryRequest });
  ndr.status = 'reattempt';
  ndr.attempt = (ndr.attempt || 1) + 1;
  await ndr.save();
  const after = await orderCount(tenantId);
  return { ndr, orderId: String(order._id), orderCount: after, createdOrder: after !== before };
}

async function convertNdrToRto(tenantId, orderNo) {
  const before = await orderCount(tenantId);
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  const ndr = await skip(NdrCase.findOne({ tenantId, orderNo }));
  if (!ndr) throw new HttpError(404, 'No NDR is open for this order');
  ndr.status = 'rto';
  await ndr.save();
  order.channelStatus = 'RTO';
  const { restockRtoOnce } = require('./orderReserve.service');
  await restockRtoOnce(tenantId, order);
  await order.save();
  const after = await orderCount(tenantId);
  return { order, ndr, orderId: String(order._id), orderCount: after, createdOrder: after !== before };
}

async function pollOpenShipments(tenantId, deps = {}) {
  const orders = await skip(Order.find({
    tenantId,
    awb: { $nin: ['', null] },
    status: { $in: ['Dispatched', 'Ready to Ship', 'Packed'] },
    $or: [{ channel: 'Shopify' }, { courier: /delhivery/i }],
  }).limit(50));
  const results = [];
  for (const order of orders) {
    if (String(order.channel).toLowerCase() !== 'shopify' && !/delhivery/i.test(order.courier || '')) continue;
    results.push(await pollDelhivery(tenantId, order.orderNo, deps));
  }
  return { checked: results.length };
}

async function listNdr(tenantId) {
  const rows = await skip(NdrCase.find({ tenantId }).sort({ updatedAt: -1 }));
  return rows.map((row) => ({
    orderNo: row.orderNo,
    awb: row.awb,
    reason: row.reason,
    attempt: row.attempt,
    phone: row.phone,
    address: row.address,
    status: row.status,
  }));
}

module.exports = {
  applyTracking,
  pollDelhivery,
  pollOpenShipments,
  reattemptNdr,
  convertNdrToRto,
  listNdr,
};
