const Order = require('../models/Order');
const Shipment = require('../models/Shipment');

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

function phoneMatch(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return null;
  return { phone: new RegExp(`${digits.split('').join('\\D*')}$`) };
}

/** The same customer is the same phone (last 10 digits) or the same email, within one tenant. */
async function customerHistory(tenantId, order, deps = {}) {
  const email = String(order.email || '').trim();
  const match = [];
  const phone = phoneMatch(order.phone);
  if (phone) match.push(phone);
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
  const past = rows.sort((a, b) => when(b) - when(a));

  // Courier already marked delivered on the shipment, but order status may still say Dispatched.
  const ships = await Shipment.find({
    tenantId,
    orderNo: { $in: past.map((row) => row.orderNo) },
    deliveryStatus: /delivered/i,
  }).select('orderNo').lean().setOptions({ skipTenantFilter: true });
  const deliveredByScan = new Set(ships.map((row) => row.orderNo));
  const withScans = past.map((row) => (
    deliveredByScan.has(row.orderNo) && !DELIVERED.has(statusKey(row.status))
      ? { ...row, status: 'Delivered' }
      : row
  ));
  const history = historyOf(withScans);

  // Shopify customer card shows lifetime order count — prefer it when available.
  if (String(order.channel || '').toLowerCase() === 'shopify' && (email || phone)) {
    try {
      const shopify = require('../adapters/shopify');
      const creds = deps.shopifyCreds || await require('./shopifyAuth.service').shopifyCreds(tenantId);
      if (shopify.hasShopifyAuth(creds)) {
        const stats = await shopify.customerOrderCount(
          creds,
          { email, phone: String(order.phone || '') },
          { request: deps.shopifyRequest },
        );
        if (stats?.ordersCount > 0) {
          // Shopify count includes the open order; Past orders excludes it.
          history.pastOrders = Math.max(history.pastOrders, Math.max(0, stats.ordersCount - 1));
          history.shopifyOrders = stats.ordersCount;
        }
      }
    } catch {
      /* rate limit / missing token — keep OMS counts */
    }
  }
  return history;
}

module.exports = { historyOf, customerHistory };
