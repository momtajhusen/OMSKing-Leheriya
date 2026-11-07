const { isRto, shippingTab, onTheWay } = require('../lib/orderTabs');

const AWAITING = new Set(['Processing', 'Packed', 'Ready to Ship']);
const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366;
const TABS = ['all', 'New', 'Processing', 'Pending', 'Dispatched', 'Delivered'];

function orderTime(order) {
  const time = new Date(order?.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Courier pickup, else label time, else the order date. */
function dispatchTime(order) {
  const time = new Date(order?.pickedUpAt || order?.labelGeneratedAt || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : orderTime(order);
}

/** Browser getTimezoneOffset minutes, limited to real zones (UTC-14..UTC+14). */
function tzMinutes(offsetMinutes) {
  const offset = Math.trunc(Number(offsetMinutes) || 0);
  return Math.min(840, Math.max(-840, offset));
}

function dayKey(value, offsetMinutes) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - tzMinutes(offsetMinutes) * 60000);
  return local.toISOString().slice(0, 10);
}

function startOfLocalDay(now, offsetMinutes) {
  const offset = tzMinutes(offsetMinutes);
  const local = new Date(now.getTime() - offset * 60000);
  local.setUTCHours(0, 0, 0, 0);
  return local.getTime() + offset * 60000;
}

function periodDays(days) {
  return Math.min(Math.max(Math.trunc(Number(days)) || 1, 1), MAX_DAYS);
}

function paise(value) {
  return Math.round((Number(value) || 0) * 100);
}

/** Booked order value excluding Cancelled orders. */
function grossSales(orders) {
  return orders
    .filter((order) => order.status !== 'Cancelled')
    .reduce((sum, order) => sum + paise(order.total), 0) / 100;
}

/**
 * Sum of order.total over orders that are neither Cancelled nor RTO, minus refunded customer returns on those
 * orders (`refunds`: orderNo -> refunded amount, capped at the order total). Summed in paise, rounded once.
 */
function netSales(orders, refunds = new Map()) {
  return orders
    .filter((order) => order.status !== 'Cancelled' && !isRto(order))
    .reduce((sum, order) => {
      const total = paise(order.total);
      return sum + total - Math.min(paise(refunds.get(order.id)), Math.max(total, 0));
    }, 0) / 100;
}

function refundsByOrder(returnRows) {
  const refunds = new Map();
  returnRows
    .filter((row) => row.refundStatus === 'refunded')
    .forEach((row) => refunds.set(row.orderNo, (paise(refunds.get(row.orderNo)) + paise(row.refundAmount)) / 100));
  return refunds;
}

function pendingPulse(order) {
  return order.status === 'Pending'
    || (order.subOrders || []).some((sub) => sub.vendorStatus === 'Pending Acceptance');
}

const RETURN_ISSUE_CHANNELS = new Set(['Shopify', 'Amazon', 'Myntra']);
const RETURN_ISSUE_DAYS = 45;
const ON_THE_WAY = new Set(['Dispatched', 'In transit']);

/** Shipped 45+ days ago and still neither delivered nor back with us; Cancelled, Voided and Paid are settled. */
function isReturnIssue(order, { now, settled, returnsByOrder }) {
  if (!RETURN_ISSUE_CHANNELS.has(order.channel)) return false;
  if (order.status === 'Cancelled' || /^void/i.test(String(order.paymentMode || ''))) return false;
  if (order.paymentStatus === 'paid' || settled.has(order.id)) return false;
  if (now - dispatchTime(order) < RETURN_ISSUE_DAYS * DAY) return false;
  const returns = returnsByOrder.get(order.id) || [];
  if (returns.includes('Completed')) return false;
  const lost = order.status !== 'Delivered' && (ON_THE_WAY.has(order.status) || isRto(order));
  const returnOpen = returns.some((status) => status !== 'Rejected') || Boolean(order.reversePickup?.returnId);
  return lost || returnOpen;
}

/** Delivered and not paid: Shopify 45 days after dispatch; Amazon/Myntra once payment is missing from their report. */
function isProblemInvoice(order, { now, settled }) {
  if (order.status !== 'Delivered' || !RETURN_ISSUE_CHANNELS.has(order.channel)) return false;
  if (order.paymentStatus === 'paid' || settled.has(order.id)) return false;
  return order.channel !== 'Shopify' || now - dispatchTime(order) >= RETURN_ISSUE_DAYS * DAY;
}

function dateOnly(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const time = Date.parse(`${text}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : '';
}

function customRange(from, to) {
  let start = dateOnly(from);
  let end = dateOnly(to);
  if (!start && !end) return null;
  if (start && end && start > end) [start, end] = [end, start];
  return { from: start, to: end };
}

/** A from more than 366 days before the end (to, else today) moves up, so KPIs and trend cover the same days. */
function capRange(range, tzOffset) {
  if (!range?.from) return range;
  const end = Date.parse(`${range.to || dayKey(Date.now(), tzOffset)}T00:00:00.000Z`);
  const earliest = new Date(end - (MAX_DAYS - 1) * DAY).toISOString().slice(0, 10);
  return range.from < earliest ? { ...range, from: earliest, capped: true } : range;
}

function trendKeys(range, days, tzOffset) {
  if (range) {
    const end = Date.parse(`${range.to || dayKey(Date.now(), tzOffset)}T00:00:00.000Z`);
    const start = range.from ? Date.parse(`${range.from}T00:00:00.000Z`) : end - 13 * DAY;
    const count = Math.min(Math.max(Math.round((end - start) / DAY) + 1, 1), MAX_DAYS);
    return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * DAY).toISOString().slice(0, 10));
  }
  const trendDays = days === 'all' || days === '' || days == null ? 14 : periodDays(days);
  const today = startOfLocalDay(new Date(), tzOffset);
  const keys = [];
  for (let i = trendDays - 1; i >= 0; i -= 1) keys.push(dayKey(today - i * DAY, tzOffset));
  return keys;
}

function buildOrderSummary(orders, {
  channel = 'all', days = 'all', from, to, series = [], tzOffset = 0, returnRows = [], settledOrderNos = [],
} = {}) {
  const returnsByOrder = new Map();
  returnRows.forEach((row) => returnsByOrder.set(row.orderNo, [...(returnsByOrder.get(row.orderNo) || []), row.status]));
  const refunds = refundsByOrder(returnRows);
  const issueContext = { now: Date.now(), settled: new Set(settledOrderNos), returnsByOrder };
  const range = capRange(customRange(from, to), tzOffset);
  const start = range || days === 'all' || days === '' || days == null
    ? 0
    : startOfLocalDay(new Date(), tzOffset) - (periodDays(days) - 1) * DAY;
  const filtered = (orders || []).filter((order) => {
    if (channel && channel !== 'all' && order.channel !== channel) return false;
    if (range) {
      const key = dayKey(order.createdAt, tzOffset);
      if (!key || (range.from && key < range.from) || (range.to && key > range.to)) return false;
      return true;
    }
    if (!start) return true;
    const time = orderTime(order);
    return time >= start;
  });
  const live = filtered.filter((order) => order.status !== 'Cancelled');
  const labels = series.length
    ? series
    : [...new Set(filtered.map((order) => order.channel).filter(Boolean))].map((label) => ({
      id: String(label).toLowerCase(),
      label,
    }));
  const trend = [];
  const index = {};
  trendKeys(range, days, tzOffset).forEach((key) => {
    const row = { date: key.slice(5) };
    labels.forEach((entry) => { row[entry.id] = 0; });
    index[key] = row;
    trend.push(row);
  });
  filtered.forEach((order) => {
    const row = index[dayKey(order.createdAt, tzOffset)];
    const field = String(order.channel || '').toLowerCase();
    if (row && Object.prototype.hasOwnProperty.call(row, field)) row[field] += 1;
  });

  const bySku = new Map();
  live.forEach((order) => {
    (order.items || []).forEach((item) => {
      const key = item.sku || item.name;
      const row = bySku.get(key) || {
        sku: item.sku,
        name: item.name,
        units: 0,
        revenue: 0,
        channels: new Set(),
        imageUrl: item.imageUrl || '',
      };
      if (!row.imageUrl && item.imageUrl) row.imageUrl = item.imageUrl;
      row.units += Number(item.qty) || 1;
      row.revenue += (Number(item.price) || 0) * (Number(item.qty) || 1);
      if (order.channel) row.channels.add(order.channel);
      bySku.set(key, row);
    });
  });
  const top = [...bySku.values()]
    .map((row) => ({
      sku: row.sku,
      name: row.name,
      units: row.units,
      revenue: row.revenue,
      channel: [...row.channels].join(', '),
      imageUrl: row.imageUrl || '',
    }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 5);

  const counts = {};
  const recent = {};
  TABS.forEach((tab) => {
    const rows = filtered.filter((order) => {
      if (tab === 'all') return true;
      if (tab === 'Pending') return pendingPulse(order);
      if (tab === 'Dispatched') return onTheWay(order);
      if (tab === 'Delivered') return shippingTab(order) === 'Delivered';
      return order.status === tab;
    });
    counts[tab] = rows.length;
    recent[tab] = [...rows]
      .sort((a, b) => orderTime(b) - orderTime(a))
      .slice(0, 5)
      .map((order) => ({
        id: order.id,
        customer: order.customer || '',
        channel: order.channel,
        total: order.total,
        status: order.status,
        createdAt: order.createdAt,
      }));
  });

  const statusCounts = {};
  filtered.forEach((order) => {
    statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
  });

  return {
    total: filtered.length,
    newOrders: filtered.filter((order) => order.status === 'New').length,
    awaitingDispatch: filtered.filter((order) => AWAITING.has(order.status)).length,
    returns: (orders || [])
      .filter((order) => !channel || channel === 'all' || order.channel === channel)
      .filter((order) => isReturnIssue(order, issueContext)).length,
    missingInvoice: live.filter((order) => isProblemInvoice(order, issueContext)).length,
    revenue: netSales(filtered, refunds),
    grossSales: grossSales(filtered),
    channels: labels.map((entry) => {
      const rows = filtered.filter((order) => order.channel === entry.label);
      return {
        channel: entry.label,
        orders: rows.length,
        newOrders: rows.filter((order) => order.status === 'New').length,
        revenue: netSales(rows, refunds),
        grossSales: grossSales(rows),
      };
    }),
    statuses: Object.entries(statusCounts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    trend,
    top,
    counts,
    recent,
    ...(range ? { range } : {}),
  };
}

module.exports = { buildOrderSummary, customRange, dayKey, netSales, grossSales, refundsByOrder };
