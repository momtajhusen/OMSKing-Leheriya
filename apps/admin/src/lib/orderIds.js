export function shortOrderId(order) {
  return String(order?.channelOrderNo || '').replace(/^#/, '').trim() || order?.id || '';
}

export function shortSubOrderId(order, sub) {
  const base = shortOrderId(order);
  if (!sub) return base;
  return base === order?.id ? sub.id : `${base}-${sub.index}`;
}
