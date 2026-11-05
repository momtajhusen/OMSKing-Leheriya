const SkuMapping = require('../models/SkuMapping');
const { HttpError } = require('../utils/httpError');
const shopify = require('../adapters/shopify');

async function shopifyVariant(tenantId, masterSkuId) {
  if (!masterSkuId) return '';
  const mapping = await SkuMapping.findOne({ tenantId, masterSkuId, channel: 'shopify', isActive: true })
    .setOptions({ skipTenantFilter: true });
  return mapping?.channelVariantId || '';
}

function shopifyCreds(tenantId) {
  return require('./shopifyAuth.service').shopifyCreds(tenantId);
}

/** Vendor purchase cost of one sub-order: saved on the line, else Shopify "Cost per item". */
async function readLineCost(tenantId, order, sub, masterSkuId) {
  if (sub.cost != null) return { cost: sub.cost, source: 'saved', editable: false };
  const variantId = await shopifyVariant(tenantId, masterSkuId);
  if (!variantId) return { cost: null, source: 'none', editable: true };
  let cost;
  try {
    cost = await shopify.readVariantCost(await shopifyCreds(tenantId), { variantId });
  } catch (err) {
    return { cost: null, source: 'shopify', editable: false, error: err.message };
  }
  if (cost == null) return { cost: null, source: 'shopify', editable: true };
  sub.cost = cost;
  await order.save();
  return { cost, source: 'shopify', editable: false };
}

/** Fills a blank cost; for a Shopify listing it is also written to Shopify, never over an existing Shopify cost. */
async function saveLineCost(tenantId, order, sub, masterSkuId, value) {
  const cost = Math.round(Number(value) * 100) / 100;
  if (value === '' || value == null || !Number.isFinite(cost) || cost <= 0) throw new HttpError(400, 'Enter a cost above 0');
  const variantId = await shopifyVariant(tenantId, masterSkuId);
  if (variantId) {
    const creds = await shopifyCreds(tenantId);
    const current = await shopify.readVariantCost(creds, { variantId });
    if (current != null) throw new HttpError(409, `Shopify already has cost ${current}. Change it in Shopify.`);
    await shopify.pushVariantCost(creds, { variantId, cost });
  }
  sub.cost = cost;
  await order.save();
  return { cost, source: variantId ? 'shopify' : 'saved', editable: false, shopifyUpdated: Boolean(variantId) };
}

module.exports = { readLineCost, saveLineCost };
