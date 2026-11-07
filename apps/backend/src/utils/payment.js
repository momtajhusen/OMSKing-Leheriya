/** COD-like: plain COD, Cash on Delivery and Shopify "Partially paid" (the rest is collected on delivery). */
function isCodLike(mode) {
  const text = String(mode || '').trim();
  if (/^void$/i.test(text)) return false;
  return /partial|cod|cash on delivery/i.test(text);
}

function fieldOf(order, path) {
  if (order[path] !== undefined) return order[path];
  return typeof order.get === 'function' ? order.get(path) : undefined;
}

/** Amount the courier must collect. codAmount null/missing means the whole order total. */
function codCollectAmount(order) {
  if (!order || !isCodLike(order.paymentMode)) return 0;
  const due = fieldOf(order, 'codAmount');
  const value = due === null || due === undefined || due === '' ? order.total : due;
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Paid: marked paid in OMSKing, or a Shopify order paid at checkout. */
function isPaid(order) {
  if (!order) return false;
  if (String(order.paymentStatus || '') === 'paid') return true;
  const financial = String(order.sourceOrderData?.financial_status || '').toLowerCase();
  return String(order.channel || '').toLowerCase() === 'shopify' && financial === 'paid';
}

module.exports = { isCodLike, codCollectAmount, isPaid };
