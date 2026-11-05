export function ordersSearchPath(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  return `/orders?${new URLSearchParams({ q })}`;
}

export function searchFromParams(searchParams) {
  return String(searchParams?.get('q') || '').trim();
}
