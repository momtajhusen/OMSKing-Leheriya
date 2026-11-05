/** Every channel (including ones added later to the registry) with its linked warehouses, main one first. */
export function groupLinks(channels = [], connections = []) {
  return channels.map((channel) => ({
    ...channel,
    links: connections
      .filter((link) => link.channel === channel.id)
      .sort((a, b) => Number(b.isPrimaryForChannel) - Number(a.isPrimaryForChannel) || a.warehouseCode.localeCompare(b.warehouseCode)),
  }));
}

/** Warehouses that can still be linked to this channel: active, not linked yet, virtual ones only for Shopify. */
export function linkableWarehouses(warehouses = [], connections = [], channelId = '') {
  const taken = new Set(connections.filter((link) => link.channel === channelId).map((link) => link.warehouseId));
  return warehouses.filter((wh) => wh.status !== 'inactive'
    && !taken.has(wh.id)
    && (wh.type !== 'virtual' || channelId === 'shopify'));
}

/** Channels a new warehouse may be linked to: a virtual warehouse holds Shopify-only stock. */
export function channelsForType(channels = [], type = 'physical') {
  return type === 'virtual' ? channels.filter((channel) => channel.id === 'shopify') : channels;
}

export function linkCount(connections = [], warehouseId = '') {
  return connections.filter((link) => link.warehouseId === warehouseId).length;
}

export function backupFileName(format = 'json', now = new Date()) {
  return `channel-warehouse-${now.toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'json'}`;
}

export function historyTime(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Small "ships from" tag for an order: code to show, and a tooltip saying why that warehouse. */
export function shipWarehouseTag(order) {
  const wh = order?.shipWarehouse;
  if (!wh?.code) return null;
  const why = { 'channel location': 'matched the channel location id', order: 'set on the order', 'main warehouse': 'main warehouse for this channel' }[wh.source] || '';
  return { code: wh.code, title: `Ships from ${wh.code} · ${wh.name}${why ? ` (${why})` : ''}` };
}

/** Text for the delete confirmation from GET /warehouses/:id/delete-check. */
export function deleteSummary(check) {
  if (!check) return null;
  const code = check.warehouse?.code || 'this warehouse';
  if (!check.canDelete) {
    return { tone: 'block', title: `${code} cannot be deleted yet`, lines: check.blockers || [], confirmLabel: '' };
  }
  const warnings = check.warnings || [];
  return {
    tone: warnings.length ? 'warn' : 'ok',
    title: warnings.length ? `Delete ${code}? Please check:` : `Delete ${code}? Nothing uses it.`,
    lines: warnings,
    confirmLabel: `Delete ${code}`,
  };
}
