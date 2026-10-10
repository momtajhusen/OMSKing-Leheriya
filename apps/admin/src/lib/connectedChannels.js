import { CHANNEL_CATALOG, orderChannelLabel } from '../constants/channelCatalog';

/** Same rule as Channel setup: a passed test on the current API environment. */
export function isChannelConnected(conn, modeOverride) {
  if (!conn) return false;
  const mode = modeOverride || conn.credentials?.apiMode || 'live';
  const tested = conn.lastTestMode || '';
  const environmentMatches = !tested || tested === mode;
  return (conn.status === 'connected' || conn.lastTestOk) && environmentMatches;
}

export function connectedCatalog(connections) {
  return CHANNEL_CATALOG.filter((channel) => isChannelConnected(connections?.[channel.id]));
}

export function connectedLabels(connections) {
  return connectedCatalog(connections).map(orderChannelLabel);
}

export function ordersOnConnectedChannels(orders, state) {
  if (!state?.loaded || state.statusError) return orders;
  const labels = new Set(connectedLabels(state.connections));
  return (orders || []).filter((order) => labels.has(order.channel));
}
