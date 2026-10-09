const Order = require('../models/Order');
const { HttpError } = require('../utils/httpError');
const { withSubOrders } = require('../lib/orderSubOrders');
const { channelById } = require('../channels/registry');

async function ingestChannelOrders(tenantId, channelId, orders = []) {
  const meta = channelById(channelId);
  if (!meta) throw new HttpError(400, 'Unknown channel');
  const out = { fetched: orders.length, created: 0, updated: 0, unchanged: 0 };
  for (const order of orders) {
    const externalOrderId = String(order.externalOrderId || '').trim();
    if (!externalOrderId) continue;
    const orderNo = `${meta.orderPrefix}-${externalOrderId}`;
    const existing = await Order.findOne({
      tenantId,
      channel: meta.name,
      externalOrderId,
    }).setOptions({ skipTenantFilter: true });
    const { prepareChannelItems, syncOrderReservations } = require('./orderReserve.service');
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
      orderDate: order.orderDate || new Date(),
      source: 'channel_api',
      externalOrderId,
      customer: order.customer || '',
      email: order.email || '',
      phone: order.phone || '',
      address: order.address || '',
      city: order.city || '',
      shipState: order.shipState || '',
      sourceOrderData: order.sourceOrderData,
    });
    await syncOrderReservations(tenantId, next);
    if (!existing) {
      await Order.create(next);
      const { notifyEventEmail } = require('./notify.service');
      await notifyEventEmail(tenantId, 'NOT-001', {
        dedupeKey: `order.new:${orderNo}`,
        subject: `New order ${orderNo}`,
        text: `Order: ${orderNo}\nChannel: ${meta.name}`,
      });
      out.created += 1;
      continue;
    }
    const before = `${existing.status}|${existing.total}`;
    existing.status = next.status;
    existing.total = next.total;
    existing.items = next.items;
    existing.subOrders = next.subOrders;
    if (next.reserveState !== undefined) existing.reserveState = next.reserveState;
    existing.paymentMode = next.paymentMode || existing.paymentMode;
    existing.orderDate = next.orderDate || existing.orderDate;
    existing.source = 'channel_api';
    await existing.save();
    if (before === `${existing.status}|${existing.total}`) out.unchanged += 1;
    else out.updated += 1;
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

module.exports = { ingestChannelOrders, applyStoredWebhook };
