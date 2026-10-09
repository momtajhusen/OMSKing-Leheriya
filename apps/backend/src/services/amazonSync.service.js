const Order = require('../models/Order');
const { getConnection, credsOf } = require('./channelConnection.service');
const amazon = require('../adapters/amazon');
const { withSubOrders } = require('../lib/orderSubOrders');
const { HttpError } = require('../utils/httpError');

async function pullAmazonOrders(tenantId) {
  const row = await getConnection(tenantId, 'amazon');
  if (!row) throw new HttpError(400, 'Amazon is not connected for this workspace');
  const creds = credsOf(row);
  const fetched = await amazon.pullOrders(creds);
  const out = { fetched: fetched.length, created: 0, updated: 0, unchanged: 0 };
  for (const order of fetched) {
    const orderNo = `AMZ-${order.externalOrderId}`;
    const existing = await Order.findOne({
      tenantId,
      channel: 'Amazon',
      externalOrderId: order.externalOrderId,
    }).setOptions({ skipTenantFilter: true });
    const next = withSubOrders({
      tenantId,
      orderNo,
      channel: 'Amazon',
      status: order.status,
      paymentMode: 'Prepaid',
      fulfilmentSource: 'Offline',
      items: order.items,
      total: order.total,
      orderDate: order.orderDate,
      source: 'channel_api',
      externalOrderId: order.externalOrderId,
      customer: '',
      email: '',
      phone: '',
      address: '',
    });
    const { syncOrderReservations } = require('./orderReserve.service');
    await syncOrderReservations(tenantId, next);
    if (!existing) {
      await Order.create(next);
      const { notifyEventEmail } = require('./notify.service');
      await notifyEventEmail(tenantId, 'NOT-001', {
        dedupeKey: `order.new:${orderNo}`,
        subject: `New order ${orderNo}`,
        text: `Order: ${orderNo}\nChannel: Amazon`,
      });
      out.created += 1;
      continue;
    }
    const before = `${existing.status}|${existing.total}`;
    existing.status = next.status;
    existing.total = next.total;
    existing.items = next.items;
    existing.subOrders = next.subOrders;
    existing.orderDate = next.orderDate || existing.orderDate;
    existing.source = 'channel_api';
    if (next.reserveState !== undefined) existing.reserveState = next.reserveState;
    await existing.save();
    if (before === `${existing.status}|${existing.total}`) out.unchanged += 1;
    else out.updated += 1;
  }
  return out;
}

module.exports = { pullAmazonOrders };
