const SkuMapping = require('../models/SkuMapping');
const shopify = require('../adapters/shopify');

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

/**
 * Push HSN to every active Shopify mapping for this Master SKU.
 * Soft-fails per variant so OMS save still succeeds if Shopify is down.
 */
async function pushMasterSkuHsnToShopify(tenantId, masterSkuId, hsn, deps = {}) {
  if (!masterSkuId) return { pushed: 0, failed: [] };
  const maps = await skip(SkuMapping.find({
    tenantId,
    masterSkuId,
    channel: { $in: ['shopify', 'Shopify'] },
    isActive: { $ne: false },
    channelVariantId: { $nin: ['', null] },
  }).select('channelVariantId channelSkuCode'));
  if (!maps.length) return { pushed: 0, failed: [] };

  let creds;
  try {
    const { shopifyCreds } = require('./shopifyAuth.service');
    creds = deps.shopifyCreds || await shopifyCreds(tenantId);
  } catch (err) {
    return { pushed: 0, failed: [{ reason: err.message || 'Shopify credentials missing' }] };
  }
  if (!shopify.hasShopifyAuth(creds)) {
    return { pushed: 0, failed: [{ reason: 'Shopify is not connected' }] };
  }

  let pushed = 0;
  const failed = [];
  for (const map of maps) {
    try {
      await shopify.pushVariantHsn(creds, {
        variantId: map.channelVariantId,
        hsn,
        request: deps.shopifyRequest,
      });
      pushed += 1;
    } catch (err) {
      failed.push({ sku: map.channelSkuCode || map.channelVariantId, reason: err.message });
    }
  }
  return { pushed, failed };
}

module.exports = { pushMasterSkuHsnToShopify };
