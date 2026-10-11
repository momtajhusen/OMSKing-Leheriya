const Inventory = require('../models/Inventory');
const WarehouseLocationMap = require('../models/WarehouseLocationMap');
const { HttpError } = require('../utils/httpError');
const { getConnection, credsOf } = require('./channelConnection.service');
const { importChannel } = require('./catalogMapping.service');
const { ensureDefaultWarehouses } = require('./warehouse.service');
const shopify = require('../adapters/shopify');
const amazon = require('../adapters/amazon');
const myntra = require('../adapters/myntra');
const { adapterFor } = require('../adapters');
const { channelById } = require('../channels/registry');
const partner = require('../adapters/partner');

const MYNTRA_CATALOG_MESSAGE = 'Myntra catalog was not pulled. Merchant Id and Secret Key are missing, so the product list API was not called.';

function blockMessage(channel, creds = {}) {
  if (channel === 'shopify' && !shopify.hasShopifyAuth(creds)) {
    return 'Shopify catalog was not pulled. Shop URL and Admin API token are missing, so the products API was not called.';
  }
  if (channel === 'amazon' && !(creds.sellerId && creds.refreshToken && creds.lwaClientId && creds.lwaClientSecret)) {
    return 'Amazon catalog was not pulled. Seller ID, refresh token, and LWA client id + secret are required before the listings API is called.';
  }
  if (channel === 'myntra' && !(creds.merchantId && creds.secretKey)) return MYNTRA_CATALOG_MESSAGE;
  const meta = channelById(channel);
  if (meta?.kind === 'partner' && !(partner.baseOf(creds) && partner.tokenOf(creds))) {
    return `${meta.name} catalog was not pulled. API host and token are required before the products API is called.`;
  }
  if (!meta) return 'Unknown channel';
  return '';
}

async function catalogPullBlock(tenantId, channel) {
  const row = await getConnection(tenantId, channel);
  return blockMessage(channel, row ? credsOf(row) : {});
}

async function bindShopifyLocations(tenantId, locations) {
  const { physical, virtual } = await ensureDefaultWarehouses(tenantId);
  const active = (locations || []).filter((loc) => loc && loc.id && loc.active !== false);
  const slots = [
    [physical._id, active[0], 'shopify-location-a', 'Shopify Location A (Offline)', true],
    [virtual._id, active[1], 'shopify-location-b', 'Shopify Location B (Virtual)', false],
  ];
  let bound = 0;
  for (const [warehouseId, loc, placeholder, label, primary] of slots) {
    if (!loc) continue;
    const externalLocationId = String(loc.id);
    const named = loc.name ? `${label} — ${loc.name}` : label;
    const current = await WarehouseLocationMap.findOne({
      tenantId, channel: 'shopify', externalLocationId,
    }).setOptions({ skipTenantFilter: true });
    if (current) {
      current.warehouseId = warehouseId;
      current.label = named;
      current.isPrimaryForChannel = primary;
      await current.save();
      bound += 1;
      continue;
    }
    const slot = await WarehouseLocationMap.findOne({
      tenantId, channel: 'shopify', warehouseId, externalLocationId: placeholder,
    }).setOptions({ skipTenantFilter: true });
    if (slot) {
      slot.externalLocationId = externalLocationId;
      slot.label = named;
      slot.isPrimaryForChannel = primary;
      await slot.save();
      bound += 1;
      continue;
    }
    await WarehouseLocationMap.create({
      tenantId,
      warehouseId,
      channel: 'shopify',
      externalLocationId,
      label: named,
      isPrimaryForChannel: primary,
    });
    bound += 1;
  }
  return bound;
}

async function ingestPulledCatalog(tenantId, userId, channel, { rows = [], locations = [] } = {}) {
  const before = await Inventory.countDocuments({ tenantId }).setOptions({ skipTenantFilter: true });
  const summary = await importChannel(tenantId, userId, channel, rows);
  const locationsBound = channel === 'shopify' ? await bindShopifyLocations(tenantId, locations) : 0;
  const after = await Inventory.countDocuments({ tenantId }).setOptions({ skipTenantFilter: true });
  return { ...summary, locationsBound, stockCreated: after - before };
}

async function pullChannel(tenantId, userId, channel, deps = {}) {
  const name = String(channel || '').toLowerCase();
  const row = await getConnection(tenantId, name);
  const creds = name === 'shopify' && row
    ? await require('./shopifyAuth.service').shopifyCreds(tenantId)
    : (row ? credsOf(row) : {});
  const blocked = blockMessage(name, creds);
  if (blocked) throw new HttpError(400, blocked);
  if (name === 'shopify') {
    const fetched = await (deps.shopifyPull || shopify.pullCatalog)(creds);
    return ingestPulledCatalog(tenantId, userId, name, fetched);
  }
  if (name === 'amazon') {
    const fetched = await (deps.amazonPull || amazon.pullCatalog)(creds);
    return ingestPulledCatalog(tenantId, userId, name, fetched);
  }
  if (channelById(name)?.kind === 'partner') {
    const adapter = adapterFor(name);
    const fetched = await (deps.partnerPull || adapter.pullCatalog)(creds);
    return ingestPulledCatalog(tenantId, userId, name, fetched);
  }
  try {
    const fetched = await (deps.myntraPull || myntra.pullCatalog)(creds);
    return ingestPulledCatalog(tenantId, userId, name, fetched);
  } catch (err) {
    if (err.channelStatus === 403 || err.statusCode === 400) throw new HttpError(400, err.message);
    throw err;
  }
}

module.exports = {
  MYNTRA_CATALOG_MESSAGE,
  catalogPullBlock,
  bindShopifyLocations,
  ingestPulledCatalog,
  pullChannel,
  myntraPull: myntra.pullProducts,
};
