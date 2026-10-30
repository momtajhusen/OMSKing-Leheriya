const SkuMapping = require('../models/SkuMapping');
const WarehouseLocationMap = require('../models/WarehouseLocationMap');
const shopify = require('../adapters/shopify');
const { HttpError } = require('../utils/httpError');
const { importOpeningStock } = require('./inventory.service');

async function importShopifyOpeningStock(tenantId, userId, deps = {}) {
  const maps = (await WarehouseLocationMap.find({ tenantId, channel: 'shopify' }).setOptions({ skipTenantFilter: true }).lean())
    .filter((row) => /^\d+$/.test(String(row.externalLocationId || '')));
  if (!maps.length) {
    throw new HttpError(400, 'Stock was not imported. Shopify locations are not linked to warehouses yet. Run a Shopify catalog pull first.');
  }
  const creds = deps.creds || await require('./shopifyAuth.service').shopifyCreds(tenantId);
  const pull = deps.pull || shopify.pullLocationOnHand;
  const mappings = await SkuMapping.find({ tenantId, channel: 'shopify', masterSkuId: { $ne: null } })
    .select('channelVariantId masterSkuId')
    .setOptions({ skipTenantFilter: true })
    .lean();
  const masterByVariant = new Map(mappings.map((row) => [String(row.channelVariantId), String(row.masterSkuId)]));

  const totals = new Map();
  let unmatched = 0;
  for (const map of maps) {
    const rows = await pull(creds, { locationId: String(map.externalLocationId) });
    rows.forEach((row) => {
      if (!(row.onHand > 0)) return;
      const masterSkuId = masterByVariant.get(String(row.variantId));
      if (!masterSkuId) {
        unmatched += 1;
        return;
      }
      const key = `${masterSkuId}:${map.warehouseId}`;
      totals.set(key, (totals.get(key) || 0) + row.onHand);
    });
  }
  const lines = [...totals].map(([key, qty]) => {
    const [masterSkuId, warehouseId] = key.split(':');
    return { masterSkuId, warehouseId, qty };
  });
  const result = await importOpeningStock(tenantId, userId, lines, {
    reason: 'Opening stock from Shopify',
    referenceType: 'shopify_opening',
  });
  return { ...result, unmatched };
}

module.exports = { importShopifyOpeningStock };
