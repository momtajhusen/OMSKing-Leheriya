const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Product = require('../src/models/Product');
const MasterSku = require('../src/models/MasterSku');
const Warehouse = require('../src/models/Warehouse');
const Inventory = require('../src/models/Inventory');
const SkuMapping = require('../src/models/SkuMapping');
const { listBalances } = require('../src/services/inventory.service');

let mongod;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

test.after(async () => {
  mongoose.set('debug', false);
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('inventory list reads the master SKU catalogue once, so large catalogues still open', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Big catalogue', slug: `big-catalogue-${stamp}`, kind: 'merchant' });
  const other = await Tenant.create({ name: 'Other', slug: `other-${stamp}`, kind: 'merchant' });
  const product = await Product.create({ tenantId: tenant._id, name: 'Kurta', images: ['https://img.test/kurta.jpg'] });
  const tracked = await MasterSku.create({ tenantId: tenant._id, productId: product._id, code: `TRK-${stamp}`, name: 'Kurta Red', costPrice: 100 });
  const untracked = await MasterSku.create({ tenantId: tenant._id, code: `NEW-${stamp}`, name: 'Kurta Blue' });
  await MasterSku.create({ tenantId: other._id, code: `OTH-${stamp}`, name: 'Not mine' });
  await listBalances(String(tenant._id));
  const physical = await Warehouse.findOne({ tenantId: tenant._id, code: 'WH-001' }).setOptions({ skipTenantFilter: true });
  await Inventory.create({
    tenantId: tenant._id,
    masterSkuId: tracked._id,
    warehouseId: physical._id,
    physicalQty: 5,
    reservedQty: 1,
    reorderPoint: 2,
    channelOnly: { amazon: 3 },
  });

  const calls = [];
  mongoose.set('debug', (collection, method) => calls.push(`${collection}.${method}`));
  const rows = await listBalances(String(tenant._id));
  mongoose.set('debug', false);

  assert.equal(calls.filter((call) => call === 'master_skus.find').length, 1, 'master SKUs are not loaded a second time through populate');
  assert.equal(calls.filter((call) => call === 'warehouses.find').length, 1, 'warehouses are not loaded a second time through populate');
  assert.equal(rows.length, 4, 'only this tenant\'s two SKUs at its two warehouses');
  const row = rows.find((item) => item.masterSkuId === String(tracked._id) && item.warehouse === 'WH-001');
  assert.equal(row.tracked, true);
  assert.equal(row.sku, `TRK-${stamp}`);
  assert.equal(row.productName, 'Kurta Red');
  assert.equal(row.imageUrl, 'https://img.test/kurta.jpg');
  assert.equal(row.cost, 100);
  assert.equal(row.warehouseId, String(physical._id));
  assert.equal(row.warehouseType, 'physical');
  assert.ok(row.channels.includes('amazon'));
  assert.equal(row.stock, 8);
  assert.equal(row.reserved, 1);
  assert.equal(row.available, 4);
  assert.equal(row.low, false);
  assert.equal(row.ats.amazon, 7);
  assert.equal(row.ats.shopify, 4);
  const pending = rows.find((item) => item.masterSkuId === String(untracked._id) && item.warehouse === 'WH-002');
  assert.equal(pending.tracked, false);
  assert.deepEqual(pending.channels, ['shopify']);
});

test('each stock row shows the Shopify SKU mapped to its Master SKU, scoped to the tenant', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Shopify SKU', slug: `shopify-sku-${stamp}`, kind: 'merchant' });
  const other = await Tenant.create({ name: 'Other shop', slug: `other-shop-${stamp}`, kind: 'merchant' });
  const mapped = await MasterSku.create({ tenantId: tenant._id, code: `15723-${stamp}`, name: 'Dupatta Green' });
  const unmapped = await MasterSku.create({ tenantId: tenant._id, code: `15724-${stamp}`, name: 'Dupatta Red' });
  await SkuMapping.create({
    tenantId: tenant._id, masterSkuId: mapped._id, channel: 'shopify', channelVariantId: `v-${stamp}`,
    channelSkuCode: 'LEH-DUP-GRN', channelSkuCodeNorm: 'leh-dup-grn', syncStatus: 'synced',
  });
  await SkuMapping.create({
    tenantId: tenant._id, masterSkuId: mapped._id, channel: 'amazon', channelVariantId: `a-${stamp}`,
    channelSkuCode: 'AMZ-ONLY', channelSkuCodeNorm: 'amz-only', syncStatus: 'synced',
  });
  await SkuMapping.create({
    tenantId: other._id, masterSkuId: unmapped._id, channel: 'shopify', channelVariantId: `o-${stamp}`,
    channelSkuCode: 'OTHER-TENANT', channelSkuCodeNorm: 'other-tenant', syncStatus: 'synced',
  });

  const rows = await listBalances(String(tenant._id));
  const greens = rows.filter((row) => row.masterSkuId === String(mapped._id));
  assert.ok(greens.length > 0);
  greens.forEach((row) => assert.equal(row.shopifySku, 'LEH-DUP-GRN', `Shopify SKU at ${row.warehouse}`));
  rows.filter((row) => row.masterSkuId === String(unmapped._id))
    .forEach((row) => assert.equal(row.shopifySku, '', 'another tenant\'s Shopify mapping never shows'));

  const found = await listBalances(String(tenant._id), { q: 'leh-dup' });
  assert.ok(found.length > 0 && found.every((row) => row.masterSkuId === String(mapped._id)), 'search finds the row by Shopify SKU');
});

test('inventory can be sorted by qty, so the most stocked SKUs at the Offline Store come first', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Sort by qty', slug: `sort-qty-${stamp}`, kind: 'merchant' });
  const low = await MasterSku.create({ tenantId: tenant._id, code: `A-${stamp}`, name: 'Low stock' });
  const high = await MasterSku.create({ tenantId: tenant._id, code: `B-${stamp}`, name: 'High stock' });
  const none = await MasterSku.create({ tenantId: tenant._id, code: `C-${stamp}`, name: 'No stock' });
  await listBalances(String(tenant._id));
  const offline = await Warehouse.findOne({ tenantId: tenant._id, code: 'WH-001' }).setOptions({ skipTenantFilter: true });
  await Inventory.create({ tenantId: tenant._id, masterSkuId: low._id, warehouseId: offline._id, physicalQty: 2 });
  await Inventory.create({ tenantId: tenant._id, masterSkuId: high._id, warehouseId: offline._id, physicalQty: 9 });
  const warehouseId = String(offline._id);

  const codes = (rows) => rows.map((row) => row.sku);
  assert.deepEqual(codes(await listBalances(String(tenant._id), { warehouseId })), [low.code, high.code, none.code], 'default order stays by SKU code');
  const desc = await listBalances(String(tenant._id), { warehouseId, sort: 'qty_desc' });
  assert.deepEqual(codes(desc), [high.code, low.code, none.code]);
  assert.deepEqual(desc.map((row) => row.stock), [9, 2, 0]);
  assert.deepEqual(codes(await listBalances(String(tenant._id), { warehouseId, sort: 'qty_asc' })), [none.code, low.code, high.code]);
  assert.deepEqual(codes(await listBalances(String(tenant._id), { warehouseId, sort: 'bogus' })), [low.code, high.code, none.code], 'an unknown sort keeps the default order');
});
