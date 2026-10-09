const Inventory = require('../models/Inventory');
const SkuMapping = require('../models/SkuMapping');
const Warehouse = require('../models/Warehouse');
const WarehouseLocationMap = require('../models/WarehouseLocationMap');
const IntegrationJob = require('../models/IntegrationJob');
const MasterSku = require('../models/MasterSku');
const { HttpError } = require('../utils/httpError');
const { getConnection, credsOf } = require('./channelConnection.service');
const { getInventoryAuthority, ensureDefaultWarehouses, sellsOn } = require('./warehouse.service');
const { channelIds } = require('../channels/registry');
const { adapterFor } = require('../adapters');
const { availableOf, channelSellable } = require('./inventory.service');
const { enqueue } = require('./jobQueue.service');
const shopify = require('../adapters/shopify');
const amazon = require('../adapters/amazon');
const myntra = require('../adapters/myntra');

function skipTenant(query) {
  return query.setOptions({ skipTenantFilter: true });
}

async function channelQty(tenantId, masterSkuId) {
  await ensureDefaultWarehouses(tenantId);
  const [warehouses, balances, locations, maps] = await Promise.all([
    skipTenant(Warehouse.find({ tenantId, status: 'active' })),
    skipTenant(Inventory.find({ tenantId, masterSkuId })),
    skipTenant(WarehouseLocationMap.find({ tenantId, channel: 'shopify' }).sort({ isPrimaryForChannel: -1, externalLocationId: 1 })),
    skipTenant(SkuMapping.find({ tenantId, masterSkuId, isActive: true, syncStatus: 'synced' })),
  ]);
  const balanceByWarehouse = new Map(balances.map((row) => [String(row.warehouseId), row]));
  const warehouseById = new Map(warehouses.map((row) => [String(row._id), row]));
  const sum = (flag, channel) => warehouses
    .filter((row) => row[flag])
    .reduce((total, row) => total + channelSellable(balanceByWarehouse.get(String(row._id)), channel), 0);
  return {
    shopify: locations.map((loc) => {
      const warehouse = warehouseById.get(String(loc.warehouseId));
      const balance = balanceByWarehouse.get(String(loc.warehouseId));
      return {
        locationId: loc.externalLocationId,
        warehouseCode: warehouse?.code || '',
        warehouseId: loc.warehouseId,
        available: warehouse?.sellOnShopify ? channelSellable(balance, 'shopify') : (balance ? availableOf(balance) : 0),
        primary: Boolean(loc.isPrimaryForChannel),
      };
    }),
    amazon: sum('sellOnAmazon', 'amazon'),
    myntra: sum('sellOnMyntra', 'myntra'),
    byChannel: Object.fromEntries(channelIds().map((id) => [
      id,
      warehouses
        .filter((row) => sellsOn(row, id))
        .reduce((total, row) => total + channelSellable(balanceByWarehouse.get(String(row._id)), id), 0),
    ])),
    mappings: maps,
  };
}

async function enqueueChannel(tenantId, userId, channel, masterSkuId) {
  const open = await skipTenant(IntegrationJob.findOne({
    tenantId,
    channel,
    jobType: 'inventory_push',
    status: { $in: ['queued', 'running'] },
    'payload.masterSkuId': String(masterSkuId),
  }));
  if (open) return open;
  return enqueue({
    tenantId,
    channel,
    jobType: 'inventory_push',
    triggeredBy: 'manual',
    triggeredByUserId: userId,
    payload: { masterSkuId: String(masterSkuId) },
  });
}

async function queueInventoryPushes(tenantId, userId, masterSkuId, onlyChannels) {
  const maps = await skipTenant(SkuMapping.find({
    tenantId,
    masterSkuId,
    isActive: true,
    syncStatus: 'synced',
    channel: { $in: channelIds() },
  }));
  const authority = await getInventoryAuthority(tenantId);
  const allow = Array.isArray(onlyChannels) ? new Set(onlyChannels) : null;
  const channels = [...new Set(maps.map((row) => row.channel))]
    .filter((channel) => !(channel === 'shopify' && authority === 'shopify'))
    .filter((channel) => !allow || allow.has(channel));
  const jobs = [];
  for (const channel of channels) {
    jobs.push(await enqueueChannel(tenantId, userId, channel, masterSkuId));
  }
  return jobs;
}

async function pushShopify(tenantId, masterSkuId, qty, deps) {
  const creds = credsOf(await getConnection(tenantId, 'shopify'));
  const mapping = qty.mappings.find((row) => row.channel === 'shopify');
  if (!mapping) {
    const err = new Error('Shopify stock was not pushed. This Master SKU has no synced Shopify listing.');
    err.terminal = true;
    throw err;
  }
  const rows = qty.shopify.map((loc) => ({
    variantId: mapping.channelVariantId,
    locationId: loc.locationId,
    available: loc.available,
  }));
  const result = await shopify.pushInventory(creds, { rows, request: deps.shopifyRequest });
  return `Shopify locations ${result.sent.map((row) => `${row.locationId}=${row.available}`).join(', ')}.`;
}

async function pullShopifyMaster(tenantId, userId, masterSkuId, qty, deps) {
  const creds = credsOf(await getConnection(tenantId, 'shopify'));
  const mapping = qty.mappings.find((row) => row.channel === 'shopify');
  const location = qty.shopify.find((row) => row.primary) || qty.shopify[0];
  if (!mapping || !location) {
    const err = new Error('Shopify location qty was not read. A synced listing and Location A are required.');
    err.terminal = true;
    throw err;
  }
  const available = await shopify.readLocationAvailable(creds, {
    variantId: mapping.channelVariantId,
    locationId: location.locationId,
    request: deps.shopifyRequest,
  });
  const { setChannelAvailable } = require('./inventory.service');
  await setChannelAvailable(tenantId, userId, {
    masterSkuId,
    warehouseId: location.warehouseId,
    available,
    reason: 'Shopify is inventory master. Location A wrote WH-001.',
  });
  return `Shopify Location A available ${available} wrote ${location.warehouseCode}. Amazon and Myntra follow that qty. Shopify was not pushed.`;
}

async function pushAmazon(tenantId, masterSkuId, qty, deps) {
  const creds = credsOf(await getConnection(tenantId, 'amazon'));
  const mapping = qty.mappings.find((row) => row.channel === 'amazon');
  if (!mapping) {
    const err = new Error('Amazon stock was not pushed. This Master SKU has no synced Amazon listing.');
    err.terminal = true;
    throw err;
  }
  const result = await amazon.pushInventory(creds, {
    sku: mapping.channelSkuCode,
    quantity: qty.amazon,
    request: deps.amazonRequest,
  });
  return `Amazon ${result.sku} quantity ${result.quantity}.`;
}

async function pushMyntra(tenantId, masterSkuId, qty, deps) {
  const creds = credsOf(await getConnection(tenantId, 'myntra'));
  const mapping = qty.mappings.find((row) => row.channel === 'myntra');
  if (!mapping) {
    const err = new Error('Myntra stock was not pushed. This Master SKU has no synced Myntra listing.');
    err.terminal = true;
    throw err;
  }
  await myntra.pushInventory(creds, {
    items: [{ sku: mapping.channelSkuCode, quantity: qty.myntra }],
    client: deps.myntraClient,
  });
  return `Myntra ${mapping.channelSkuCode} quantity ${qty.myntra}.`;
}

async function runInventoryJob(job, deps = {}) {
  const masterSkuId = job.payload?.masterSkuId;
  if (!masterSkuId) {
    const maps = await skipTenant(SkuMapping.find({
      tenantId: job.tenantId,
      channel: job.channel,
      isActive: true,
      syncStatus: 'synced',
      masterSkuId: { $ne: null },
    }));
    const ids = [...new Set(maps.map((row) => String(row.masterSkuId)))];
    for (const id of ids) await enqueueChannel(job.tenantId, job.triggeredByUserId, job.channel, id);
    const summary = ids.length
      ? `Queued ${ids.length} ${job.channel} inventory pushes.`
      : `${job.channel} stock was not pushed. No synced listing is mapped.`;
    await IntegrationJob.updateOne({ _id: job._id }, { $set: { shortSummary: summary, recordsTotal: ids.length } })
      .setOptions({ skipTenantFilter: true });
    if (!ids.length) {
      const err = new Error(summary);
      err.terminal = true;
      throw err;
    }
    return { queued: ids.length };
  }
  const sku = await skipTenant(MasterSku.findOne({ _id: masterSkuId, tenantId: job.tenantId }));
  if (!sku) {
    const err = new HttpError(400, 'Master SKU was not found. Stock was not pushed.');
    err.terminal = true;
    throw err;
  }
  const qty = await channelQty(job.tenantId, sku._id);
  const authority = await getInventoryAuthority(job.tenantId);
  let summary;
  if (job.channel === 'shopify' && authority === 'shopify') {
    summary = await pullShopifyMaster(job.tenantId, job.triggeredByUserId, sku._id, qty, deps);
  } else if (job.channel === 'shopify') {
    summary = await pushShopify(job.tenantId, sku._id, qty, deps);
  } else if (job.channel === 'amazon') {
    summary = await pushAmazon(job.tenantId, sku._id, qty, deps);
  } else if (job.channel === 'myntra') {
    summary = await pushMyntra(job.tenantId, sku._id, qty, deps);
  } else {
    const adapter = adapterFor(job.channel);
    const mapping = qty.mappings.find((row) => row.channel === job.channel);
    if (!adapter?.pushInventory || !mapping) {
      const err = new Error(`${job.channel} stock was not pushed. This Master SKU has no synced listing.`);
      err.terminal = true;
      throw err;
    }
    const creds = credsOf(await getConnection(job.tenantId, job.channel));
    summary = await adapter.pushInventory(creds, {
      sku: mapping.channelSkuCode,
      quantity: qty.byChannel?.[job.channel] || 0,
      request: deps.partnerRequest,
    });
    summary = `${job.channel} ${summary}`;
  }
  await IntegrationJob.updateOne(
    { _id: job._id },
    { $set: { shortSummary: summary, recordsTotal: 1, recordsProcessed: 1 } },
  ).setOptions({ skipTenantFilter: true });
  return { summary, qty };
}

module.exports = {
  channelQty,
  queueInventoryPushes,
  runInventoryJob,
};
