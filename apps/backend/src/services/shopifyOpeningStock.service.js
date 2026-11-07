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
  const mappings = await SkuMapping.find({ tenantId, channel: 'shopify', masterSkuId: { $ne: null }, isActive: { $ne: false } })
    .select('channelVariantId channelSkuCode masterSkuId')
    .setOptions({ skipTenantFilter: true })
    .lean();
  const mappingByVariant = new Map(mappings.map((row) => [String(row.channelVariantId), row]));

  // Two listings of one Master SKU at one location count the same shelf: take the larger, never the sum.
  const byLocation = new Map();
  let unmatched = 0;
  for (const map of maps) {
    const rows = await pull(creds, { locationId: String(map.externalLocationId) });
    rows.forEach((row) => {
      if (!(row.onHand > 0)) return;
      const mapping = mappingByVariant.get(String(row.variantId));
      if (!mapping) {
        unmatched += 1;
        return;
      }
      const key = `${mapping.masterSkuId}:${map.warehouseId}:${map.externalLocationId}`;
      const listing = { sku: mapping.channelSkuCode || '', variantId: String(row.variantId), onHand: row.onHand };
      byLocation.set(key, [...(byLocation.get(key) || []), listing]);
    });
  }
  const totals = new Map();
  const conflicts = [];
  byLocation.forEach((listings, key) => {
    const [masterSkuId, warehouseId, locationId] = key.split(':');
    const qty = Math.max(...listings.map((row) => row.onHand));
    if (new Set(listings.map((row) => row.onHand)).size > 1) conflicts.push({ masterSkuId, locationId, taken: qty, listings });
    const line = totals.get(`${masterSkuId}:${warehouseId}`) || { masterSkuId, warehouseId, qty: 0, sku: listings[0].sku };
    line.qty += qty;
    totals.set(`${masterSkuId}:${warehouseId}`, line);
  });
  const result = await importOpeningStock(tenantId, userId, [...totals.values()], {
    reason: 'Opening stock from Shopify',
    referenceType: 'shopify_opening',
  });
  return { ...result, unmatched, conflicts };
}

module.exports = { importShopifyOpeningStock };
