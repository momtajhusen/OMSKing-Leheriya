import { dayKey } from './orderMetrics.js';

/** Orders for one channel and an inclusive from/to period (YYYY-MM-DD, local days). Empty values mean no limit. */
export function filterReportOrders(orders, { channel = '', from: start = '', to: end = '' } = {}) {
  const [from, to] = start && end && start > end ? [end, start] : [start, end];
  return orders.filter((order) => {
    if (channel && order.channel !== channel) return false;
    if (!from && !to) return true;
    const day = order.createdAt ? dayKey(order.createdAt) : '';
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

/** Return/cancellation rows ({ kind, order }) by channel, type, payment mode and order-date period. */
export function filterReturnRows(rows, { channel = '', kind = '', payment = '', from = '', to = '' } = {}) {
  const kept = new Set(filterReportOrders(rows.map((row) => row.order), { channel, from, to }));
  return rows.filter((row) => kept.has(row.order)
    && (!kind || row.kind === kind)
    && (!payment || row.order.paymentMode === payment));
}
