const CHANNEL_INVOICED = new Set(['Myntra', 'Amazon']);

/** Same rule as the backend: these orders get their tax invoice from the marketplace, not from OMS. */
export function channelIssuesInvoice(order) {
  return CHANNEL_INVOICED.has(String(order?.channel || '')) && ['channel_api', 'channel_push'].includes(order?.source);
}
