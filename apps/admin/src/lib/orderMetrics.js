import { CHANNEL_CATALOG, orderChannelLabel } from '../constants/channelCatalog.js';

export const CHANNELS = CHANNEL_CATALOG.map((row) => orderChannelLabel(row));

const DAY = 24 * 60 * 60 * 1000;

export function isCancelled(order) {
  return order.status === 'Cancelled';
}

export function orderTime(order) {
  const t = new Date(order.createdAt || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function dayKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const IST_MS = 330 * 60 * 1000;
const ON_THE_WAY = ['Dispatched', 'In transit'];

/** YYYY-MM-DD of the instant on the Asia/Kolkata calendar; a plain YYYY-MM-DD is kept as it is. */
export function istDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? new Date(time + IST_MS).toISOString().slice(0, 10) : '';
}

export function istMonth(value) {
  return istDate(value).slice(0, 7);
}

/** Same rule as the backend (lib/orderTabs.js): an RTO status, or an RTO code on the order or a channel line. */
export function isRto(order) {
  if (/^rto\b|returned to origin/i.test(String(order?.status || ''))) return true;
  const codes = `${order?.channelStatus || ''} ${(order?.channelLines || []).map((line) => line.status || '').join(' ')}`;
  return codes.toUpperCase().includes('RTO');
}

/** Pickup & Manifest plus In Transit on the Orders list. */
export function onTheWay(order) {
  return ON_THE_WAY.includes(order.status) && !isRto(order);
}

function paise(value) {
  return Math.round((Number(value) || 0) * 100);
}

/** Money total summed in paise and rounded once. */
export function sumMoney(values) {
  return (values || []).reduce((sum, value) => sum + paise(value), 0) / 100;
}

/** order id -> refunded amount, from GET /returns rows with refundStatus 'refunded'. */
export function refundsByOrder(returns) {
  const refunds = new Map();
  (returns || [])
    .filter((row) => row.refundStatus === 'refunded')
    .forEach((row) => refunds.set(row.orderId, sumMoney([refunds.get(row.orderId), row.refundAmount])));
  return refunds;
}

/** Booked order value excluding cancelled orders. */
export function grossSales(orders) {
  return sumMoney(orders.filter((order) => !isCancelled(order)).map((order) => order.total));
}

/** Same rule as the backend summary: order value excluding Cancelled and RTO orders, minus refunded returns. */
export function netSales(orders, refunds = new Map()) {
  return orders
    .filter((order) => !isCancelled(order) && !isRto(order))
    .reduce((sum, order) => {
      const total = paise(order.total);
      return sum + total - Math.min(paise(refunds.get(order.id)), Math.max(total, 0));
    }, 0) / 100;
}

export function salesByChannel(orders, channels = CHANNELS, refunds = new Map()) {
  return channels.map((channel) => {
    const rows = orders.filter((order) => order.channel === channel);
    return { channel, orders: rows.length, revenue: netSales(rows, refunds) };
  });
}

function trackingOf(order) {
  return order.awb || (order.channelLines || []).find((line) => line.trackingNumber)?.trackingNumber || '';
}

/** Shipping report over orders with a tracking number, using the Orders list shipping tabs. */
export function shippingStats(orders) {
  const shipped = orders.filter((order) => trackingOf(order));
  const couriers = {};
  shipped.forEach((order) => {
    const name = order.courier || `${order.channel} logistics`;
    couriers[name] = couriers[name] || { courier: name, shipments: 0, delivered: 0, cancelled: 0 };
    couriers[name].shipments += 1;
    if (order.status === 'Delivered' && !isRto(order)) couriers[name].delivered += 1;
    if (order.status === 'Cancelled') couriers[name].cancelled += 1;
  });
  return {
    total: shipped.length,
    delivered: shipped.filter((order) => order.status === 'Delivered' && !isRto(order)).length,
    inTransit: shipped.filter(onTheWay).length,
    cancelledAfterDispatch: shipped.filter(isCancelled).length,
    rto: shipped.filter(isRto).length,
    couriers: Object.values(couriers).sort((a, b) => b.shipments - a.shipments),
  };
}

const DEAD_LINE = /^(cancel+ed|rejected)$/i;

/** Vendor sub-order lines for reports, without cancelled / rejected lines or lines of cancelled orders. */
export function vendorReportLines(orders, labelOf = (name) => name) {
  return orders
    .filter((order) => !isCancelled(order))
    .flatMap((order) => (order.subOrders || [])
      .filter((sub) => sub.assignedVendor && !DEAD_LINE.test(sub.status || '') && !DEAD_LINE.test(sub.vendorStatus || ''))
      .map((sub) => ({ order, sub, vendor: labelOf(sub.assignedVendor), month: istMonth(sub.assignedDate || order.createdAt) })));
}

/** Refund for a customer return: refundAmount, else the return line value, else the order value. */
function customerRefund(order, returns) {
  const mine = (returns || []).filter((row) => row.orderId === order.id && row.kind !== 'rto');
  const refunded = sumMoney(mine.map((row) => row.refundAmount));
  if (refunded > 0) return refunded;
  const value = sumMoney(mine.map((row) => row.amount));
  return value > 0 ? value : Number(order.total) || 0;
}

/** Returns & refunds reconciliation rows: customer returns, cancellations and RTO orders (even still on Dispatched). */
export function refundRows(orders, workflow, returns) {
  return orders.flatMap((order) => {
    if (order.reversePickup?.returnId) {
      const state = workflow[order.reversePickup.returnId] || {};
      return [{
        key: order.reversePickup.returnId,
        order,
        kind: 'Customer return',
        shipped: true,
        received: state.status === 'Completed',
        refund: customerRefund(order, returns),
      }];
    }
    if (!isCancelled(order) && !isRto(order)) return [];
    const shipped = Boolean(trackingOf(order)) || isRto(order);
    const state = workflow[`RTO-${order.id}`] || {};
    return [{
      key: order.id,
      order,
      kind: shipped ? 'Cancelled after dispatch (RTO)' : 'Cancelled before dispatch',
      shipped,
      received: !shipped || state.status === 'QC Complete',
      refund: order.paymentMode === 'COD' ? 0 : Number(order.total) || 0,
    }];
  }).sort((a, b) => orderTime(b.order) - orderTime(a.order));
}

export function statusCounts(orders) {
  const counts = {};
  orders.forEach((order) => { counts[order.status] = (counts[order.status] || 0) + 1; });
  return Object.entries(counts).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
}

/** Orders per day per channel for the last `days` days, ending today. */
export function ordersTrend(orders, days = 14, catalog = CHANNEL_CATALOG) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = [];
  const index = {};
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKey(today.getTime() - i * DAY);
    const row = { date: key.slice(5) };
    catalog.forEach((channel) => { row[channel.id] = 0; });
    index[key] = row;
    rows.push(row);
  }
  orders.forEach((order) => {
    const row = index[dayKey(order.createdAt)];
    const field = String(order.channel || '').toLowerCase();
    if (row && Object.prototype.hasOwnProperty.call(row, field)) row[field] += 1;
  });
  return rows;
}

export function topSkus(orders, limit = 5) {
  const bySku = new Map();
  orders.filter((order) => !isCancelled(order)).forEach((order) => {
    (order.items || []).forEach((item) => {
      const key = item.sku || item.name;
      const row = bySku.get(key) || { sku: item.sku, name: item.name, units: 0, revenue: 0, channels: new Set(), imageUrl: item.imageUrl || '' };
      if (!row.imageUrl && item.imageUrl) row.imageUrl = item.imageUrl;
      row.units += Number(item.qty) || 1;
      row.revenue += (Number(item.price) || 0) * (Number(item.qty) || 1);
      row.channels.add(order.channel);
      bySku.set(key, row);
    });
  });
  return [...bySku.values()]
    .map((row) => ({ ...row, channel: [...row.channels].join(', ') }))
    .sort((a, b) => b.units - a.units)
    .slice(0, limit);
}

/** GST split for one line: inclusive price, CGST+SGST for intra-state, IGST otherwise. */
export function lineTax(item, { intraState = false } = {}) {
  const rate = Number(item.gst) || 0;
  const gross = (Number(item.price) || 0) * (Number(item.qty) || 1);
  const taxable = rate ? gross / (1 + rate / 100) : gross;
  const tax = gross - taxable;
  return {
    rate,
    gross,
    taxable,
    cgst: intraState ? tax / 2 : 0,
    sgst: intraState ? tax / 2 : 0,
    igst: intraState ? 0 : tax,
  };
}

export function relativeTime(value) {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < DAY) return `${Math.round(diff / 3600000)} h ago`;
  return `${Math.round(diff / DAY)} d ago`;
}

export function downloadCsv(filename, header, rows) {
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((row) => row.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
