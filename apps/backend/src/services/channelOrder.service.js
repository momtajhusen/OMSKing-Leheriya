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

async function finishChannelOrder(tenantId, doc, { created, before, orderNo, channelName, refresh = false }) {
  const { syncOrderReservations } = require('./orderReserve.service');
  await syncOrderReservations(tenantId, doc);
  await doc.save();
  if (!created) {
    const after = refresh
      ? `${doc.status}|${doc.total}|${doc.customer}|${doc.phone}|${doc.address}|${doc.city}|${doc.email}|${(doc.items || []).map((i) => `${i.sku}:${i.price}:${i.discount || 0}`).join(',')}`
      : `${doc.status}|${doc.total}`;
    return before === after ? 'unchanged' : 'updated';
  }
  const { notifyEventEmail } = require('./notify.service');
  await notifyEventEmail(tenantId, 'NOT-001', {
    dedupeKey: `order.new:${orderNo}`,
    subject: `New order ${orderNo}`,
    text: `Order: ${orderNo}\nChannel: ${channelName}`,
  });
  return 'created';
}

async function ingestChannelOrders(tenantId, channelId, orders = [], opts = {}) {
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
      before = opts.refresh
        ? `${doc.status}|${doc.total}|${doc.customer}|${doc.phone}|${doc.address}|${doc.city}|${doc.email}|${(doc.items || []).map((i) => `${i.sku}:${i.price}:${i.discount || 0}`).join(',')}`
        : `${doc.status}|${doc.total}`;
      require('./orderReserve.service').mergeChannelStatus(doc, next.status);
      if (!moneyLocked(doc)) {
        doc.codAmount = next.codAmount;
        doc.shippingCharge = next.shippingCharge;
      }
      applyChannelTotal(doc, next.total);
      doc.currency = next.currency;
      // Keep existing coupon lines if the pull returned selling price without allocations.
      // Never replace a full items table with an empty pull (cancelled Shopify qty=0 wipe).
      if ((next.items || []).length) {
        doc.items = (next.items || []).map((item, index) => {
          const prev = (doc.items || [])[index];
          const fromChannel = Number(item.discount) > 0;
          const discount = fromChannel
            ? Number(item.discount)
            : (Number(prev?.discount) || 0);
          const price = Number(item.price) || 0;
          // Recalculate Final when we kept the old coupon — incoming finalPrice is full price.
          const finalPrice = fromChannel && Number(item.finalPrice) > 0
            ? Number(item.finalPrice)
            : Math.round(Math.max(0, price - discount) * 100) / 100;
          return { ...item, discount, finalPrice };
        });
        if (next.subOrders) doc.subOrders = next.subOrders;
      }
      if (next.reserveState !== undefined) doc.reserveState = next.reserveState;
      // Never let an incomplete Shopify pull (empty gateways) demote a known COD to Prepaid.
      if (next.paymentMode === 'Prepaid' && doc.paymentMode === 'COD') {
        /* keep COD */
      } else {
        doc.paymentMode = next.paymentMode || doc.paymentMode;
      }
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
      // refresh=true (Single Order Sync): pull customer/address/phone even when a pin already exists.
      if (opts.refresh ? !doc.awb : (!savedPin && incomingPin)) {
        if (next.address) doc.address = next.address;
        if (next.city) doc.city = next.city;
        if (next.shipState) doc.shipState = next.shipState;
        if (next.phone) doc.phone = next.phone;
        if (next.customer) doc.customer = next.customer;
        if (next.email) doc.email = next.email;
      }
    }
    const outcome = await finishChannelOrder(tenantId, doc, {
      created,
      before,
      orderNo,
      channelName: meta.name,
      refresh: Boolean(opts.refresh),
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
