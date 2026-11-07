/** Same rule as the API isPaid (apps/backend/src/utils/payment.js): marked paid, or a Shopify checkout payment. */
export function isPaid(order) {
  if (!order) return false;
  if (order.paid === true || String(order.paymentStatus || '') === 'paid') return true;
  const financial = String(order.sourceOrderData?.financial_status || '').toLowerCase();
  return String(order.channel || '').toLowerCase() === 'shopify' && financial === 'paid';
}

/** Payment reconciliation lists delivered orders only; a paid Shopify order has nothing left to collect. */
export function awaitsPayment(order) {
  if (!order || order.status !== 'Delivered') return false;
  return !(order.channel === 'Shopify' && isPaid(order));
}
