function localDate(now) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function periodParams(range, from = '', to = '', now = new Date()) {
  if (range === 'today') {
    const today = localDate(now);
    return { from: today, to: today };
  }
  if (range !== 'custom') return { days: range };
  if (!from && !to) return { days: 'all' };
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export function periodLabel(range, from = '', to = '') {
  if (range === 'today') return 'Today';
  if (range === 'custom') {
    if (from && to) return `${from} to ${to}`;
    if (from) return `From ${from}`;
    if (to) return `Up to ${to}`;
    return 'Last 14 Days';
  }
  return range === 'all' ? 'Last 14 Days' : `Last ${range} Days`;
}
