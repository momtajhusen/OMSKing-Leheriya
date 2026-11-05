export function ordersChannelPath(channel) {
  const label = String(channel || '').trim();
  if (!label || label === 'all') return '/orders';
  return `/orders?${new URLSearchParams({ channel: label })}`;
}

export function channelFromSearch(searchParams) {
  return String(searchParams?.get('channel') || '').trim() || 'all';
}
