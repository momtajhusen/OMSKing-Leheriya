import { CHANNEL_CATALOG, orderChannelLabel } from '../constants/channelCatalog';

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

/** Order value excluding cancelled orders. */
export function netSales(orders) {
  return orders.filter((order) => !isCancelled(order)).reduce((sum, order) => sum + (Number(order.total) || 0), 0);
}

export function salesByChannel(orders, channels = CHANNELS) {
  return channels.map((channel) => {
    const rows = orders.filter((order) => order.channel === channel);
    return { channel, orders: rows.length, revenue: netSales(rows) };
  });
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
