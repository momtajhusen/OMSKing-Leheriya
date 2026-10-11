const AWAITING = new Set(['Processing', 'Packed', 'Ready to Ship']);
const DAY = 24 * 60 * 60 * 1000;
const TABS = ['all', 'New', 'Processing', 'Pending', 'Dispatched', 'Delivered'];

function orderTime(order) {
  const time = new Date(order?.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function dayKey(value, offsetMinutes) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = Number(offsetMinutes) || 0;
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function startOfLocalDay(now, offsetMinutes) {
  const offset = Number(offsetMinutes) || 0;
  const local = new Date(now.getTime() - offset * 60000);
  local.setUTCHours(0, 0, 0, 0);
  return local.getTime() + offset * 60000;
}

function netSales(orders) {
  return orders
    .filter((order) => order.status !== 'Cancelled')
    .reduce((sum, order) => sum + (Number(order.total) || 0), 0);
}

function pendingPulse(order) {
  return order.status === 'Pending'
    || (order.subOrders || []).some((sub) => sub.vendorStatus === 'Pending Acceptance');
}

function buildOrderSummary(orders, { channel = 'all', days = 'all', series = [], tzOffset = 0 } = {}) {
  const start = days === 'all' || days === '' || days == null ? 0 : Date.now() - Number(days) * DAY;
  const filtered = (orders || []).filter((order) => {
    if (channel && channel !== 'all' && order.channel !== channel) return false;
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
  const trendDays = days === 'all' || days === '' || days == null ? 14 : Number(days);
  const today = startOfLocalDay(new Date(), tzOffset);
  const trend = [];
  const index = {};
  for (let i = trendDays - 1; i >= 0; i -= 1) {
    const key = dayKey(today - i * DAY, tzOffset);
    const row = { date: key.slice(5) };
    labels.forEach((entry) => { row[entry.id] = 0; });
    index[key] = row;
    trend.push(row);
  }
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
      return order.status === tab;
    });
    counts[tab] = rows.length;
    recent[tab] = [...rows]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
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
    returns: filtered.filter((order) => order.reversePickup?.returnId).length,
    missingInvoice: live.filter((order) => ['Dispatched', 'Delivered'].includes(order.status) && !order.invoiceNo).length,
    revenue: netSales(filtered),
    channels: labels.map((entry) => {
      const rows = filtered.filter((order) => order.channel === entry.label);
      return { channel: entry.label, orders: rows.length, revenue: netSales(rows) };
    }),
    statuses: Object.entries(statusCounts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    trend,
    top,
    counts,
    recent,
  };
}

module.exports = { buildOrderSummary };
