const shopify = require('../adapters/shopify');
const { HttpError } = require('../utils/httpError');

const FIELDS = ['customer', 'phone', 'email', 'address', 'city', 'shipState'];
const LOCKED = new Set(['Dispatched', 'In transit', 'Delivered', 'Cancelled']);

function cleanChanges(order, body) {
  const changes = {};
  for (const key of FIELDS) {
    const value = body[key] === undefined ? order[key] : body[key];
    changes[key] = String(value ?? '').trim().slice(0, 300);
  }
  if (!changes.customer) throw new HttpError(400, 'Customer name is required');
  if (!changes.address) throw new HttpError(400, 'Shipping address is required');
  if (changes.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email)) throw new HttpError(400, 'Email is not valid');
  return changes;
}

/** Edits customer and shipping details. With pushToShopify, Shopify is updated first and OMS saves only if it accepts. */
async function editOrder(tenantId, order, body = {}, deps = {}) {
  if (order.channel === 'Amazon' || order.channel === 'Myntra') {
    throw new HttpError(400, `${order.channel} orders are edited in the seller panel.`);
  }
  if (LOCKED.has(order.status)) throw new HttpError(400, `A ${order.status} order cannot be edited.`);
  if (order.awb) throw new HttpError(400, 'A label is already generated. Cancel the label before editing the order.');
  const changes = cleanChanges(order, body);
  const pushToShopify = body.pushToShopify === true;
  if (pushToShopify) {
    if (order.channel !== 'Shopify' || !order.externalOrderId) {
      throw new HttpError(400, 'This order did not come from Shopify, so it cannot be pushed there.');
    }
    const creds = deps.shopifyCreds || await require('./shopifyAuth.service').shopifyCreds(tenantId);
    if (!shopify.hasShopifyAuth(creds)) {
      throw new HttpError(400, 'Shopify shop URL and admin token are missing. Nothing was changed.');
    }
    await shopify.updateOrderAddress(creds, {
      orderId: order.externalOrderId,
      changes,
      request: deps.shopifyRequest,
    });
  }
  const before = Object.fromEntries(FIELDS.map((key) => [key, order[key] || '']));
  Object.assign(order, changes);
  (order.subOrders || []).forEach((sub) => {
    sub.customer = changes.customer;
    sub.address = changes.address;
  });
  await order.save();
  return { order, before, after: changes, pushed: pushToShopify };
}

module.exports = { editOrder };
