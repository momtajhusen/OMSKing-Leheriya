const Order = require('../models/Order');
const Shipment = require('../models/Shipment');
const NdrCase = require('../models/NdrCase');
const { HttpError } = require('../utils/httpError');
const delhivery = require('../adapters/couriers/delhivery');
const amazonShipping = require('../adapters/couriers/amazonShipping');
const bluedart = require('../adapters/couriers/bluedart');
const maruti = require('../adapters/couriers/maruti');

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
  const ignored = (reason) => ({ order, shipment: null, duplicate: false, ignored: reason, orderCount: before, orderId });
  if (order.status === 'Cancelled') return ignored('Order is cancelled');
  let shipment = waybill
    ? await skip(Shipment.findOne({ tenantId, orderNo, awb: waybill, status: 'booked' }))
    : await skip(Shipment.findOne({ tenantId, orderNo, status: 'booked' }));
  if (!shipment) {
    const otherBooked = await skip(Shipment.exists({ tenantId, orderNo, status: 'booked' }));
    const cancelled = waybill && await skip(Shipment.exists({ tenantId, orderNo, awb: waybill, status: 'cancelled' }));
    if (!waybill || otherBooked || cancelled || (order.awb && order.awb !== waybill)) return ignored('No booked shipment for this AWB');
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

  const delivered = order.status === 'Delivered';
  const rto = order.channelStatus === 'RTO' || Boolean(order.rtoRestockedAt);
  if (delivered || (rto && ORDER_STATUS[status])) {
    // History only: a delivered order never moves back, and an RTO parcel is not delivered to the customer.
  } else if (status === 'ndr') {
    const seen = (shipment.trackingEvents || []).filter((row) => row.status === 'ndr').length;
    const attemptNo = Math.max(seen, Number(attempt) || 0, 1);
    const existing = await skip(NdrCase.findOne({ tenantId, orderNo }));
    const limit = existing?.maxAttempts || 3;
    const elevated = attemptNo >= limit || existing?.status === 'rto';
    await NdrCase.findOneAndUpdate(
      { tenantId, orderNo },
      {
        $set: {
          awb: waybill,
          reason: detail || 'Delivery attempt failed',
          attempt: attemptNo,
          status: elevated ? 'rto' : 'open',
        },
        $setOnInsert: { tenantId, orderNo, maxAttempts: limit },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).setOptions({ skipTenantFilter: true });
    if (elevated) {
      order.channelStatus = 'RTO';
      const { restockRtoOnce } = require('./orderReserve.service');
      await restockRtoOnce(tenantId, order);
      await order.save();
    }
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
    if (!order.pickedUpAt) order.pickedUpAt = new Date();
    if (waybill) order.awb = waybill;
    await order.save();
    if (ORDER_STATUS[status] === 'Delivered') {
      // Delivered ends NDR — do not keep it in the failed-delivery queue.
      await skip(NdrCase.deleteMany({ tenantId, orderNo }));
    }
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

const AMAZON_SHIPPING = 'amazon-shipping';

const BLUE_DART = 'bluedart';
const SHREE_MARUTI = 'shree-maruti';

/** Which courier API tracks this order: 'delhivery', 'amazon-shipping', 'bluedart', 'shree-maruti', or '' (marketplace or typed AWB). */
function trackingCourier(order) {
  const name = String(order.courier || '').trim().toLowerCase();
  if (name === 'amazon shipping') return AMAZON_SHIPPING;
  if (name === 'bluedart' || name === 'blue dart') return BLUE_DART;
  if (name === 'shree maruti' || name === 'shree-maruti' || name === 'maruti') return SHREE_MARUTI;
  if (/delhivery/.test(name)) return 'delhivery';
  if (!name && String(order.channel || '').toLowerCase() === 'shopify') return 'delhivery';
  return '';
}

async function amazonShippingCreds(tenantId) {
  const CourierAccount = require('../models/CourierAccount');
  const { decryptObject } = require('../lib/secretBox');
  const row = await skip(CourierAccount.findOne({ tenantId, code: AMAZON_SHIPPING, status: 'active' }));
  const creds = row ? decryptObject(row.credentialsEnc) : null;
  return creds && String(creds.refreshToken || '').trim() ? creds : null;
}

async function bluedartTrackCreds(tenantId) {
  const { activeCourierCreds } = require('./courierAccount.service');
  const creds = await activeCourierCreds(tenantId, BLUE_DART);
  return creds && String(creds.licenceKey || '').trim() && String(creds.loginId || '').trim() ? creds : null;
}

async function marutiTrackCreds(tenantId) {
  const { activeCourierCreds } = require('./courierAccount.service');
  const creds = await activeCourierCreds(tenantId, SHREE_MARUTI);
  return creds && String(creds.apiKey || '').trim() && String(creds.email || '').trim() ? creds : null;
}

async function pollDelhivery(tenantId, orderNo, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (trackingCourier(order) !== 'delhivery') {
    const where = String(order.channel || '').toLowerCase() === 'shopify' ? `${order.courier} tracking is not on Delhivery` : `${order.channel} tracking stays on the marketplace`;
    const err = new HttpError(400, `${where}. Delhivery was not called.`);
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

async function pollAmazonShipping(tenantId, orderNo, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  const shipment = await skip(Shipment.findOne({ tenantId, orderNo, status: 'booked', courier: AMAZON_SHIPPING }));
  if (!shipment?.awb || !shipment.carrierId) {
    const err = new HttpError(400, 'This order has no Amazon Shipping tracking id. Amazon was not called.');
    err.terminal = true;
    throw err;
  }
  const creds = deps.amazonShippingCreds || await amazonShippingCreds(tenantId);
  const { events } = await amazonShipping.track(creds, { trackingId: shipment.awb, carrierId: shipment.carrierId }, { request: deps.amazonShippingRequest });
  const applied = [];
  for (const event of events) {
    applied.push(await applyTracking(tenantId, { orderNo, awb: shipment.awb, ...event }, deps));
  }
  return { orderNo, applied: applied.length };
}

async function pollBluedart(tenantId, orderNo, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (trackingCourier(order) !== BLUE_DART) {
    const err = new HttpError(400, `${order.courier || 'This courier'} tracking is not on Blue Dart. Blue Dart was not called.`);
    err.terminal = true;
    throw err;
  }
  const awb = String(order.awb || '').trim();
  if (!awb) {
    const err = new HttpError(400, 'This order has no Blue Dart AWB. Blue Dart was not called.');
    err.terminal = true;
    throw err;
  }
  const creds = deps.bluedartCreds || await bluedartTrackCreds(tenantId);
  if (!creds) {
    const err = new HttpError(400, 'Bluedart credentials are missing. Blue Dart was not called.');
    err.terminal = true;
    throw err;
  }
  const { events } = await bluedart.track(creds, awb, { request: deps.bluedartRequest });
  const applied = [];
  for (const event of events) {
    applied.push(await applyTracking(tenantId, { orderNo, awb, ...event }, deps));
  }
  return { orderNo, applied: applied.length };
}

async function pollMaruti(tenantId, orderNo, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (trackingCourier(order) !== SHREE_MARUTI) {
    const err = new HttpError(400, `${order.courier || 'This courier'} tracking is not on Shree Maruti. Shree Maruti was not called.`);
    err.terminal = true;
    throw err;
  }
  const awb = String(order.awb || '').trim();
  if (!awb) {
    const err = new HttpError(400, 'This order has no Shree Maruti AWB. Shree Maruti was not called.');
    err.terminal = true;
    throw err;
  }
  const creds = deps.marutiCreds || await marutiTrackCreds(tenantId);
  if (!creds) {
    const err = new HttpError(400, 'Shree Maruti credentials are missing. Shree Maruti was not called.');
    err.terminal = true;
    throw err;
  }
  const { events } = await maruti.track(creds, awb, { request: deps.marutiRequest });
  const applied = [];
  for (const event of events) {
    applied.push(await applyTracking(tenantId, { orderNo, awb, ...event }, deps));
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
  if (order.status === 'Delivered') throw new HttpError(400, 'This order was delivered, so it cannot be turned into an RTO.');
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
  const { activeCourierCreds } = require('./courierAccount.service');
  const creds = deps.delhiveryCreds || await activeCourierCreds(tenantId, 'delhivery');
  const delhiveryReady = Boolean(String(creds?.apiToken || '').trim());
  const amazonCreds = deps.amazonShippingCreds || await amazonShippingCreds(tenantId);
  const blueCreds = deps.bluedartCreds || await bluedartTrackCreds(tenantId);
  const marutiCreds = deps.marutiCreds || await marutiTrackCreds(tenantId);
  if (!delhiveryReady && !amazonCreds && !blueCreds && !marutiCreds) {
    return { checked: 0, failed: 0, skipped: 'courier' };
  }
  // Recent Dispatched first — Leheriya has 1000+ open AWBs; an unsorted limit(50) never reached fresh Delhivery NDRs.
  const orders = await skip(Order.find({
    tenantId,
    awb: { $nin: ['', null] },
    status: { $in: ['Dispatched', 'Ready to Ship', 'Packed'] },
    $or: [
      { channel: 'Shopify' },
      { courier: /delhivery/i },
      { courier: /blue\s*dart/i },
      { courier: /shree[-\s]?maruti/i },
      { courier: /^maruti$/i },
    ],
  }).sort({ updatedAt: -1 }).limit(200));
  const results = [];
  let failed = 0;
  for (const order of orders) {
    const courier = trackingCourier(order);
    try {
      if (courier === 'delhivery' && delhiveryReady) {
        results.push(await pollDelhivery(tenantId, order.orderNo, { ...deps, delhiveryCreds: creds }));
      } else if (courier === AMAZON_SHIPPING && amazonCreds) {
        results.push(await pollAmazonShipping(tenantId, order.orderNo, { ...deps, amazonShippingCreds: amazonCreds }));
      } else if (courier === BLUE_DART && blueCreds) {
        results.push(await pollBluedart(tenantId, order.orderNo, { ...deps, bluedartCreds: blueCreds }));
      } else if (courier === SHREE_MARUTI && marutiCreds) {
        results.push(await pollMaruti(tenantId, order.orderNo, { ...deps, marutiCreds }));
      }
    } catch (err) {
      failed += 1;
    }
  }
  return { checked: results.length, failed, skipped: '' };
}

async function pollActiveCouriers() {
  const CourierAccount = require('../models/CourierAccount');
  const rows = await CourierAccount.find({ source: 'own', code: { $in: ['delhivery', AMAZON_SHIPPING, BLUE_DART, SHREE_MARUTI] }, status: 'active' })
    .select('tenantId')
    .setOptions({ skipTenantFilter: true });
  const seen = new Set();
  let checked = 0;
  for (const row of rows) {
    const id = String(row.tenantId);
    if (seen.has(id)) continue;
    seen.add(id);
    const result = await pollOpenShipments(row.tenantId);
    checked += result.checked || 0;
  }
  return { companies: seen.size, checked };
}

async function listNdr(tenantId) {
  const rows = await skip(NdrCase.find({ tenantId, status: { $in: ['open', 'reattempt'] } }).sort({ updatedAt: -1 }));
  const orderNos = [...new Set(rows.map((row) => row.orderNo).filter(Boolean))];
  const orders = orderNos.length
    ? await skip(Order.find({ tenantId, orderNo: { $in: orderNos } }).select('orderNo channelOrderNo channel status courier'))
    : [];
  const byNo = new Map(orders.map((order) => [order.orderNo, order]));
  const CLOSED = new Set(['Delivered', 'Cancelled']);
  return rows
    .filter((row) => {
      const order = byNo.get(row.orderNo);
      return order && !CLOSED.has(order.status);
    })
    .map((row) => {
      const order = byNo.get(row.orderNo);
      return {
        orderNo: row.orderNo,
        channelOrderNo: order?.channelOrderNo || '',
        channel: order?.channel || '',
        courier: order?.courier || '',
        awb: row.awb,
        reason: row.reason,
        attempt: row.attempt,
        phone: row.phone,
        address: row.address,
        status: row.status,
      };
    });
}

module.exports = {
  applyTracking,
  pollDelhivery,
  pollAmazonShipping,
  pollBluedart,
  pollMaruti,
  pollOpenShipments,
  pollActiveCouriers,
  reattemptNdr,
  convertNdrToRto,
  listNdr,
};
