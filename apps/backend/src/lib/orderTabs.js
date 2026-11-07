const SHIPPING_TABS = ['Pickup & Manifest', 'In Transit', 'Delivered', 'RTO'];
const ON_THE_WAY = ['Dispatched', 'In transit'];

/** Returned to origin: an RTO order status, or an RTO code from the channel on the order or a line. */
function isRto(row) {
  if (/^rto\b|returned to origin/i.test(String(row?.status || ''))) return true;
  const codes = `${row?.channelStatus || ''} ${(row?.channelLines || []).map((line) => line.status || '').join(' ')}`;
  return codes.toUpperCase().includes('RTO');
}

/** Orders list shipping tab; `waiting` holds booked OMSKing shipments with no courier scan yet. */
function shippingTab(row, waiting = new Set()) {
  if (isRto(row)) return 'RTO';
  if (row.status === 'Delivered') return 'Delivered';
  if (ON_THE_WAY.includes(row.status)) return waiting.has(row.id) ? 'Pickup & Manifest' : 'In Transit';
  return '';
}

/** Pickup & Manifest plus In Transit: with no waiting set every such order lands on In Transit. */
function onTheWay(row) {
  return shippingTab(row) === 'In Transit';
}

module.exports = { SHIPPING_TABS, ON_THE_WAY, isRto, shippingTab, onTheWay };
