const Order = require('../models/Order');
const { HttpError } = require('../utils/httpError');
const shopify = require('../adapters/shopify');
const { ingestChannelOrders } = require('./channelOrder.service');

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

/** Pull this one Shopify order from Admin API and refresh the OMS row (address/items/prices). */
async function syncShopifyOrder(tenantId, orderNo, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (String(order.channel || '').toLowerCase() !== 'shopify') {
    throw new HttpError(400, `${order.channel} orders are not synced from Shopify.`);
  }
  const externalId = String(order.externalOrderId || '').trim();
  if (!externalId) throw new HttpError(400, 'This order has no Shopify order id to sync.');
  const creds = deps.shopifyCreds || await require('./shopifyAuth.service').shopifyCreds(tenantId);
  if (!shopify.hasShopifyAuth(creds)) {
    throw new HttpError(400, 'Shopify shop URL and admin token are missing. This order was not synced.');
  }
  const mapped = await shopify.pullOneOrder(creds, externalId, { request: deps.shopifyRequest });
  const result = await ingestChannelOrders(tenantId, 'shopify', [mapped], { refresh: true });
  const fresh = await skip(Order.findOne({ tenantId, orderNo }));
  return { order: fresh, result };
}

module.exports = { syncShopifyOrder };
