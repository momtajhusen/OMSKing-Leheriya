const crypto = require('crypto');
const ChannelConnection = require('../models/ChannelConnection');
const WebhookEvent = require('../models/WebhookEvent');
const Order = require('../models/Order');
const { credsOf, getConnection, patchCreds } = require('./channelConnection.service');
const { safeEqual } = require('../adapters/signature');
const {
  mapMyntraOrder,
  upsertMappedOrder,
  ingestOrderSkus,
  masterNamesFor,
  connectedClient,
} = require('./myntraSync.service');

const EVENT_TYPES = new Set([
  'itemcancellation', 'onhold', 'unhold', 'shipped', 'delivered',
  'trackingnumberupdate', 'itemblock', 'itemnsts', 'itemxpacked',
]);

const OK_CREATED = (statusMessage) => ({ statusCode: 1006, statusMessage, statusType: 'SUCCESS' });
const OK_UPDATED = (statusMessage) => ({ statusCode: 1008, statusMessage, statusType: 'SUCCESS' });

class MyntraPushError extends Error {
  constructor(httpStatus, statusMessage) {
    super(statusMessage);
    this.httpStatus = httpStatus;
    this.body = { statusCode: httpStatus === 401 ? 2001 : 3001, statusMessage, statusType: 'ERROR' };
  }
}

/** Myntra sends the seller-shared PPMP token in the access_token header. */
async function tenantForToken(token) {
  const presented = String(token || '').trim();
  if (!presented) throw new MyntraPushError(401, 'access_token header is required');
  const rows = await ChannelConnection.find({ channel: 'myntra' }).setOptions({ skipTenantFilter: true });
  const matches = rows.filter((row) => {
    const expected = String(credsOf(row).token || '');
    return expected && safeEqual(expected, presented);
  });
  if (matches.length !== 1) throw new MyntraPushError(401, 'Invalid access_token');
  return matches[0].tenantId;
}

async function recordEvent(tenantId, topic, externalEventId, payload) {
  try {
    const event = await WebhookEvent.create({
      tenantId,
      channel: 'myntra',
      externalEventId,
      topic,
      payload,
      headers: { topic },
      receivedAt: new Date(),
      status: 'received',
      correlationId: crypto.randomUUID(),
      applied: false,
      applyCount: 0,
      duplicateCount: 0,
    });
    return { event, duplicate: false };
  } catch (err) {
    if (err.code !== 11000) throw err;
    const event = await WebhookEvent.findOneAndUpdate(
      { tenantId, channel: 'myntra', externalEventId },
      { $inc: { duplicateCount: 1 }, $set: { lastDuplicateAt: new Date() } },
      { new: true },
    ).setOptions({ skipTenantFilter: true });
    return { event, duplicate: true };
  }
}

async function markEvent(event, error) {
  if (!event) return;
  await WebhookEvent.updateOne(
    { _id: event._id },
    error
      ? { $set: { status: 'failed', lastError: String(error.message || error).slice(0, 500) } }
      : { $set: { status: 'processed', processedAt: new Date(), applied: true, lastError: '' }, $inc: { applyCount: 1 } },
  ).setOptions({ skipTenantFilter: true });
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex').slice(0, 16);
}

function orderKeyOf(payload, sellerOrderId) {
  const line = (payload.orderLineEntries || [])[0] || {};
  return String(payload.orderId || payload.storeOrderId || line.orderId || line.storeOrderId || sellerOrderId);
}

async function applyOrderPayload(tenantId, sellerOrderId, payload) {
  const detail = { ...payload, sellerOrderId: payload.sellerOrderId || sellerOrderId };
  const skuInfo = await ingestOrderSkus(tenantId, null, [detail]);
  const masters = await masterNamesFor(tenantId, skuInfo.skus);
  return upsertMappedOrder(tenantId, mapMyntraOrder(orderKeyOf(detail, sellerOrderId), [detail], masters));
}

/** POST storefront/v4/order/:sellerOrderId — idempotent; duplicates still return 1006. */
async function createOrder({ token, sellerOrderId, payload }) {
  const tenantId = await tenantForToken(token);
  const { event, duplicate } = await recordEvent(tenantId, 'order.create', `order:${sellerOrderId}`, payload);
  if (duplicate && event?.status === 'processed') return OK_CREATED('Order created successfully.');
  try {
    await applyOrderPayload(tenantId, sellerOrderId, payload || {});
    await markEvent(event);
  } catch (err) {
    await markEvent(event, err);
    throw new MyntraPushError(500, 'Error while Creating Order');
  }
  return OK_CREATED('Order created successfully.');
}

/** PUT storefront/v4/order/:sellerOrderId/:eventType — re-reads the order from Myntra so every event shape is handled. */
async function orderEvent({ token, sellerOrderId, eventType, payload }) {
  const tenantId = await tenantForToken(token);
  const type = String(eventType || '').toLowerCase();
  if (!EVENT_TYPES.has(type)) throw new MyntraPushError(400, `Unsupported event type ${eventType}`);
  const eventId = `order:${sellerOrderId}:${type}:${digest(payload)}`;
  const { event, duplicate } = await recordEvent(tenantId, `order.${type}`, eventId, payload);
  if (duplicate && event?.status === 'processed') return OK_UPDATED('Order updated successfully');
  try {
    const { client } = await connectedClient(tenantId);
    const detail = await client.getOrder(sellerOrderId);
    const existing = await Order.findOne({ tenantId, 'channelLines.sellerOrderId': String(sellerOrderId) })
      .setOptions({ skipTenantFilter: true });
    const key = existing?.externalOrderId || orderKeyOf(detail, sellerOrderId);
    await upsertMappedOrder(tenantId, mapMyntraOrder(key, [{ ...detail, sellerOrderId }]));
    await markEvent(event);
  } catch (err) {
    await markEvent(event, err);
    throw new MyntraPushError(500, 'Error while updating order');
  }
  return OK_UPDATED('Order updated successfully');
}

/** POST storefront/v4/return/:id (RTO or customer return) and PUT .../return/:id/update. */
async function returnEvent({ token, returnId, payload, update = false }) {
  const tenantId = await tenantForToken(token);
  const body = payload || {};
  const id = String(body.id || returnId);
  const topic = update ? 'return.update' : 'return.create';
  const eventId = update ? `return:${id}:update:${digest(body)}` : `return:${id}`;
  const { event, duplicate } = await recordEvent(tenantId, topic, eventId, body);
  const ok = update ? OK_UPDATED('Return Updated Successfully') : OK_CREATED('Return Created Successfully');
  if (duplicate && event?.status === 'processed') return ok;
  try {
    const order = body.sellerOrderId
      ? await Order.findOne({ tenantId, 'channelLines.sellerOrderId': String(body.sellerOrderId) })
        .setOptions({ skipTenantFilter: true })
      : null;
    if (order) {
      order.reversePickup = {
        ...(order.reversePickup?.toObject?.() || order.reversePickup || {}),
        returnId: id,
        awb: body.trackingNumber != null ? String(body.trackingNumber) : order.reversePickup?.awb || '',
        courier: body.type === 'COURIER_RETURN' ? 'Myntra RTO' : 'Myntra Return',
        reason: String(body.reason || ''),
        bookedAt: order.reversePickup?.bookedAt || new Date(),
      };
      order.channelStatus = [order.channelStatus, `${body.type || 'RETURN'}:${body.status || ''}`]
        .filter(Boolean).join(', ').slice(0, 200);
      await order.save();
    }
    await markEvent(event);
  } catch (err) {
    await markEvent(event, err);
    throw new MyntraPushError(500, update ? 'Error while updating return' : 'Error while creating return');
  }
  return ok;
}

/** Creates (or rotates) the token the seller shares with Myntra for push calls. Returned once. */
async function rotatePushToken(tenantId) {
  const row = await getConnection(tenantId, 'myntra');
  if (!row) throw new MyntraPushError(400, 'Save the Myntra connection first');
  const token = crypto.randomBytes(24).toString('hex');
  await patchCreds(row, { token });
  return token;
}

module.exports = {
  MyntraPushError,
  tenantForToken,
  createOrder,
  orderEvent,
  returnEvent,
  rotatePushToken,
};
