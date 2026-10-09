/**
 * Every marketplace the product sells on. Orders, stock, listings, jobs and
 * webhooks read this list. A new channel is a row here plus an adapter.
 */
const CHANNELS = [
  { id: 'shopify', name: 'Shopify', orderPrefix: 'SHP', seesVirtual: true, kind: 'shopify' },
  { id: 'amazon', name: 'Amazon', orderPrefix: 'AMZ', seesVirtual: false, kind: 'amazon' },
  { id: 'myntra', name: 'Myntra', orderPrefix: 'MYN', seesVirtual: false, kind: 'myntra' },
  { id: 'flipkart', name: 'Flipkart', orderPrefix: 'FK', seesVirtual: false, kind: 'partner' },
  { id: 'meesho', name: 'Meesho', orderPrefix: 'MSH', seesVirtual: false, kind: 'partner' },
  { id: 'ajio', name: 'AJIO', orderPrefix: 'AJ', seesVirtual: false, kind: 'partner' },
  { id: 'nykaa', name: 'Nykaa', orderPrefix: 'NYK', seesVirtual: false, kind: 'partner' },
];

function channelIds() {
  return CHANNELS.map((row) => row.id);
}

function channelById(id) {
  const key = String(id || '').trim().toLowerCase();
  return CHANNELS.find((row) => row.id === key) || null;
}

function isKnownChannel(id) {
  return Boolean(channelById(id));
}

module.exports = {
  CHANNELS,
  channelIds,
  channelById,
  isKnownChannel,
};
