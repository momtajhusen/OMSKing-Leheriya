const LOCKED = new Set(['Dispatched', 'In transit', 'Delivered', 'Cancelled']);
const FIELDS = ['customer', 'phone', 'email', 'address', 'city', 'shipState'];

export function canEditOrder(order) {
  if (!order || order.channel === 'Amazon' || order.channel === 'Myntra') return false;
  return !order.awb && !LOCKED.has(order.status);
}

export function asksShopifyPush(order) {
  return order?.channel === 'Shopify' && Boolean(order?.externalOrderId);
}

export function orderEditForm(order) {
  return Object.fromEntries(FIELDS.map((key) => [key, order?.[key] || '']));
}
