const Order = require('../models/Order');
const { HttpError } = require('../utils/httpError');
const { withSubOrders } = require('../lib/orderSubOrders');
const { channelById } = require('../channels/registry');

function duplicateKey(err) {
  return err?.code === 11000 || err?.code === 11001 || err?.cause?.code === 11000;
}

function writeConflict(err) {
  return err?.code === 112 || err?.codeName === 'WriteConflict';
}

function insertPayload(next) {
  const doc = { ...next };
  delete doc.subOrderIndexMap;
  delete doc.id;
  delete doc.createdAt;
  return doc;
}

/**
 * One Master Order per company + channel + channel order id.
 * A concurrent second delivery hits the unique index and reloads the winner.
 */
async function claimChannelOrder(filter, insert, attempt = 0) {
  try {
    const raw = await Order.findOneAndUpdate(
      filter,
      { $setOnInsert: insertPayload(insert) },
      { upsert: true, new: true, includeResultMetadata: true, setDefaultsOnInsert: true },
    ).setOptions({ skipTenantFilter: true });
    const doc = raw?.value;
    if (!doc) {
      const again = await Order.findOne(filter).setOptions({ skipTenantFilter: true });
      if (!again) throw new Error('Channel order was not saved');
      return { doc: again, created: false };
    }
    return { doc, created: raw.lastErrorObject?.updatedExisting !== true };
  } catch (err) {
    if (duplicateKey(err) || (writeConflict(err) && attempt < 2)) {
      const doc = await Order.findOne(filter).setOptions({ skipTenantFilter: true });
      if (doc) return { doc, created: false };
      if (writeConflict(err) && attempt < 2) return claimChannelOrder(filter, insert, attempt + 1);
    }
    throw err;
  }
}

function moneyLocked(doc) {
  return Boolean(doc.invoiceGeneratedAt || String(doc.awb || '').trim());
}

/** After invoice/AWB the channel may not move the total silently; the change is kept for review. */
function applyChannelTotal(doc, total) {
  const to = Number(total) || 0;
  const from = Number(doc.total) || 0;
  if (to === from) return;
  if (moneyLocked(doc)) {
    doc.totalChangedAfterLock = { from, to, at: new Date() };
    return;
  }
  doc.total = to;
}

async function finishChannelOrder(tenantId, doc, { created, before, orderNo, channelName }) {
  const { syncOrderReservations } = require('./orderReserve.service');
  await syncOrderReservations(tenantId, doc);
  await doc.save();
  if (!created) return before === `${doc.status}|${doc.total}` ? 'unchanged' : 'updated';
  const { notifyEventEmail } = require('./notify.service');
  await notifyEventEmail(tenantId, 'NOT-001', {
    dedupeKey: `order.new:${orderNo}`,
    subject: `New order ${orderNo}`,
    text: `Order: ${orderNo}\nChannel: ${channelName}`,
  });
  return 'created';
}

async function ingestChannelOrders(tenantId, channelId, orders = []) {
  const meta = channelById(channelId);
  if (!meta) throw new HttpError(400, 'Unknown channel');
  const out = { fetched: orders.length, created: 0, updated: 0, unchanged: 0 };
  const { prepareChannelItems } = require('./orderReserve.service');
  for (const order of orders) {
    const externalOrderId = String(order.externalOrderId || '').trim();
    if (!externalOrderId) continue;
    const orderNo = `${meta.orderPrefix}-${externalOrderId}`;
    const items = await prepareChannelItems(tenantId, channelId, order.items || []);
    const next = withSubOrders({
      tenantId,
      orderNo,
      channel: meta.name,
      status: order.status || 'New',
      paymentMode: order.paymentMode || 'Prepaid',
      fulfilmentSource: 'Offline',
      items,
      total: Number(order.total) || 0,
      codAmount: order.codAmount == null ? null : Number(order.codAmount) || 0,
      shippingCharge: Number(order.shippingCharge) || 0,
      currency: String(order.currency || 'INR'),
      orderDate: order.orderDate || new Date(),
      source: 'channel_api',
      externalOrderId,
      channelOrderNo: String(order.channelOrderNo || '').trim(),
      customer: order.customer || '',
      email: order.email || '',
      phone: order.phone || '',
      address: order.address || '',
      city: order.city || '',
      shipState: order.shipState || '',
      courier: String(order.courier || '').trim(),
      awb: String(order.awb || '').trim(),
      sourceOrderData: order.sourceOrderData,
    });
    const { doc, created } = await claimChannelOrder(
      { tenantId, channel: meta.name, externalOrderId },
      next,
    );
    let before = null;
    if (!created) {
      before = `${doc.status}|${doc.total}`;
      require('./orderReserve.service').mergeChannelStatus(doc, next.status);
      if (!moneyLocked(doc)) {
        doc.codAmount = next.codAmount;
        doc.shippingCharge = next.shippingCharge;
      }
      applyChannelTotal(doc, next.total);
      doc.currency = next.currency;
      doc.items = next.items;
      doc.subOrders = next.subOrders;
      if (next.reserveState !== undefined) doc.reserveState = next.reserveState;
      doc.paymentMode = next.paymentMode || doc.paymentMode;
      doc.orderDate = next.orderDate || doc.orderDate;
      doc.source = 'channel_api';
      if (next.channelOrderNo) doc.channelOrderNo = next.channelOrderNo;
      if (!doc.email && next.email) doc.email = next.email;
      if (!doc.awb && next.awb) {
        doc.awb = next.awb;
        doc.courier = next.courier || doc.courier;
      }
      const savedPin = /\b\d{6}\b/.test(`${doc.address || ''} ${doc.city || ''}`);
      const incomingPin = /\b\d{6}\b/.test(`${next.address || ''} ${next.city || ''}`);
      if (!savedPin && incomingPin) {
        doc.address = next.address;
        doc.city = next.city;
        if (next.shipState) doc.shipState = next.shipState;
        if (next.phone) doc.phone = next.phone;
        if (next.customer) doc.customer = next.customer;
      }
    }
    const outcome = await finishChannelOrder(tenantId, doc, {
      created,
      before,
      orderNo,
      channelName: meta.name,
    });
    out[outcome] += 1;
  }
  return out;
}

async function applyStoredWebhook(event) {
  const shopify = require('../adapters/shopify');
  const topic = String(event?.topic || event?.payload?.topic || '').toLowerCase();
  const payload = event?.payload || {};
  const raw = payload.order && Array.isArray(payload.order.line_items) ? payload.order : payload;
  if (event.channel === 'shopify' && Array.isArray(raw.line_items)) {
    const { getConnection, credsOf } = require('./channelConnection.service');
    const row = await getConnection(event.tenantId, 'shopify');
    const mapped = shopify.mapShopifyOrder(raw, row ? credsOf(row) : {});
    if (!mapped) return 'ignored';
    if (topic.includes('cancel')) mapped.status = 'Cancelled';
    await ingestChannelOrders(event.tenantId, 'shopify', [mapped]);
    return 'order';
  }
  if (topic.includes('cancel')) {
    const externalOrderId = String(raw.id || raw.order_id || '').trim();
    if (!externalOrderId) return 'ignored';
    const meta = channelById(event.channel);
    if (!meta) return 'ignored';
    const order = await Order.findOne({
      tenantId: event.tenantId,
      channel: meta.name,
      externalOrderId,
    }).setOptions({ skipTenantFilter: true });
    if (!order) return 'ignored';
    order.status = 'Cancelled';
    const { syncOrderReservations } = require('./orderReserve.service');
    await syncOrderReservations(event.tenantId, order);
    await order.save();
    return 'cancel';
  }
  return 'ignored';
}

module.exports = { ingestChannelOrders, applyStoredWebhook, claimChannelOrder, finishChannelOrder, applyChannelTotal, moneyLocked };
