const Order = require('../models/Order');

const DELIVERED = new Set(['delivered']);
const CANCELLED = new Set(['cancelled', 'canceled', 'rto']);

const statusKey = (status) => String(status || '').trim().toLowerCase();
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Counts and risk for a customer's earlier orders, newest first. Risk only looks at delivered and cancelled orders. */
function historyOf(pastOrders) {
  const delivered = pastOrders.filter((row) => DELIVERED.has(statusKey(row.status))).length;
  const cancelled = pastOrders.filter((row) => CANCELLED.has(statusKey(row.status))).length;
  let risk = '';
  if (delivered + cancelled > 0) {
    if (!delivered) risk = 'High';
    else if (!cancelled) risk = 'Low';
    else risk = 'Medium';
  }
  const last = pastOrders[0];
  return {
    pastOrders: pastOrders.length,
    delivered,
    cancelled,
    lastOrderStatus: last?.status || '',
    lastOrderNo: last?.orderNo || '',
    risk,
  };
}

/** The same customer is the same phone (last 10 digits, any formatting) or the same email, within one tenant. */
async function customerHistory(tenantId, order) {
  const digits = String(order.phone || '').replace(/\D/g, '').slice(-10);
  const email = String(order.email || '').trim();
  const match = [];
  if (digits.length === 10) match.push({ phone: new RegExp(`${digits.split('').join('\\D*')}$`) });
  if (email) match.push({ email: new RegExp(`^\\s*${escapeRegex(email)}\\s*$`, 'i') });
  if (!match.length) return historyOf([]);
  const placed = order.orderDate || order.createdAt;
  const rows = await Order.find({
    tenantId,
    _id: { $ne: order._id },
    $or: match,
    ...(placed ? { $expr: { $lt: [{ $ifNull: ['$orderDate', '$createdAt'] }, placed] } } : {}),
  })
    .select('orderNo status orderDate createdAt')
    .lean()
    .setOptions({ skipTenantFilter: true });
  const when = (row) => new Date(row.orderDate || row.createdAt || 0).getTime();
  return historyOf(rows.sort((a, b) => when(b) - when(a)));
}

module.exports = { historyOf, customerHistory };
