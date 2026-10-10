const { getConnection, credsOf } = require('./channelConnection.service');
const amazon = require('../adapters/amazon');
const { withSubOrders } = require('../lib/orderSubOrders');
const { HttpError } = require('../utils/httpError');
const { claimChannelOrder, finishChannelOrder } = require('./channelOrder.service');

async function pullAmazonOrders(tenantId, { skipExternalIds = [], afterEach } = {}) {
  const row = await getConnection(tenantId, 'amazon');
  if (!row) throw new HttpError(400, 'Amazon is not connected for this workspace');
  const creds = credsOf(row);
  const fetched = await amazon.pullOrders(creds);
  const skip = new Set((skipExternalIds || []).map((id) => String(id)));
  const out = { fetched: fetched.length, created: 0, updated: 0, unchanged: 0 };
  for (const order of fetched) {
    const externalOrderId = String(order.externalOrderId || '');
    if (externalOrderId && skip.has(externalOrderId)) {
      out.unchanged += 1;
      continue;
    }
    const orderNo = `AMZ-${order.externalOrderId}`;
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
    const { doc, created } = await claimChannelOrder(
      { tenantId, channel: 'Amazon', externalOrderId: order.externalOrderId },
      next,
    );
    let before = null;
    if (!created) {
      before = `${doc.status}|${doc.total}`;
      doc.status = next.status;
      doc.total = next.total;
      doc.items = next.items;
      doc.subOrders = next.subOrders;
      doc.orderDate = next.orderDate || doc.orderDate;
      doc.source = 'channel_api';
      if (next.reserveState !== undefined) doc.reserveState = next.reserveState;
    }
    const outcome = await finishChannelOrder(tenantId, doc, {
      created,
      before,
      orderNo,
      channelName: 'Amazon',
    });
    out[outcome] += 1;
    if (afterEach && externalOrderId) await afterEach(externalOrderId);
  }
  return out;
}

module.exports = { pullAmazonOrders };
