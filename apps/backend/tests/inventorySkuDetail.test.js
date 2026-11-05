const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Product = require('../src/models/Product');
const MasterSku = require('../src/models/MasterSku');
const Warehouse = require('../src/models/Warehouse');
const Inventory = require('../src/models/Inventory');
const InventoryLedger = require('../src/models/InventoryLedger');
const SkuMapping = require('../src/models/SkuMapping');
const { listBalances, skuDetail } = require('../src/services/inventory.service');

let mongod;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

function ledgerRow(tenantId, masterSkuId, warehouseId, movementType, qtyDelta, recordedAt) {
  return {
    tenantId, masterSkuId, warehouseId, movementType, qtyDelta, recordedAt,
    transactionId: `tx-${movementType}-${qtyDelta}-${recordedAt.getTime()}`,
    balanceAfter: 0,
  };
}

test('product page shows the Master SKU details and its stock in every warehouse, from this tenant only', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Leheriya', slug: `leheriya-${stamp}`, kind: 'merchant' });
  const other = await Tenant.create({ name: 'Other', slug: `other-${stamp}`, kind: 'merchant' });
  const product = await Product.create({
    tenantId: tenant._id, name: 'South Cotton Mangalgiri', category: 'Dress Material', images: ['https://img.test/suit.jpg'],
  });
  const sku = await MasterSku.create({
    tenantId: tenant._id,
    productId: product._id,
    code: `LEH-${stamp}`,
    name: 'South Cotton Mangalgiri 3pc Salwar Suit | Color Black',
    hsnCode: '5407',
    gstRatePercent: 5,
    mrp: 2899,
    sellingPrice: 1999,
    costPrice: 700,
    weightKg: 0.45,
    dimensionsCm: { l: 10, w: 10, h: 10 },
    barcode: '890100',
  });
  const otherSku = await MasterSku.create({ tenantId: other._id, code: `OTH-${stamp}`, name: 'Not mine' });
  await listBalances(String(tenant._id));
  const offline = await Warehouse.findOne({ tenantId: tenant._id, code: 'WH-001' }).setOptions({ skipTenantFilter: true });
  await Inventory.create({
    tenantId: tenant._id, masterSkuId: sku._id, warehouseId: offline._id, physicalQty: 9, reservedQty: 1, reorderPoint: 0,
  });
  const soldAt = new Date('2026-06-10T11:05:50Z');
  await InventoryLedger.create([
    ledgerRow(tenant._id, sku._id, offline._id, 'purchase_receipt', 10, new Date('2026-01-01T00:00:00Z')),
    ledgerRow(tenant._id, sku._id, offline._id, 'adjustment_plus', 16, new Date('2026-02-01T00:00:00Z')),
    ledgerRow(tenant._id, sku._id, offline._id, 'adjustment_minus', -2, new Date('2026-02-02T00:00:00Z')),
    ledgerRow(tenant._id, sku._id, offline._id, 'fulfilment_deduct', -3, soldAt),
    ledgerRow(tenant._id, sku._id, offline._id, 'return_restock', 1, new Date('2026-07-01T00:00:00Z')),
    ledgerRow(other._id, sku._id, offline._id, 'purchase_receipt', 500, new Date('2026-01-01T00:00:00Z')),
  ]);

  const detail = await skuDetail(String(tenant._id), String(sku._id));

  assert.equal(detail.sku.id, String(sku._id));
  assert.equal(detail.sku.code, `LEH-${stamp}`);
  assert.equal(detail.sku.name, 'South Cotton Mangalgiri 3pc Salwar Suit | Color Black');
  assert.equal(detail.sku.productId, String(product._id));
  assert.equal(detail.sku.category, 'Dress Material');
  assert.equal(detail.sku.imageUrl, 'https://img.test/suit.jpg');
  assert.equal(detail.sku.hsnCode, '5407');
  assert.equal(detail.sku.gstRatePercent, 5);
  assert.equal(detail.sku.mrp, 2899);
  assert.equal(detail.sku.sellingPrice, 1999);
  assert.equal(detail.sku.costPrice, 700);
  assert.equal(detail.sku.weightKg, 0.45);
  assert.deepEqual(detail.sku.dimensionsCm, { l: 10, w: 10, h: 10 });
  assert.ok(detail.sku.createdAt, 'date created is shown');

  assert.equal(detail.warehouses.length, 2, 'one block per active warehouse, even with no stock yet');
  const wh1 = detail.warehouses.find((row) => row.warehouse === 'WH-001');
  assert.equal(wh1.tracked, true);
  assert.equal(wh1.stock, 9);
  assert.equal(wh1.reserved, 1);
  assert.equal(wh1.available, 8);
  assert.equal(wh1.counts.purchased, 10);
  assert.equal(wh1.counts.manualAdjustments, 14, 'stock adjustments in and out, net');
  assert.equal(wh1.counts.shipped, 3);
  assert.equal(wh1.counts.returned, 1);
  assert.equal(new Date(wh1.counts.lastSoldAt).toISOString(), soldAt.toISOString());
  const wh2 = detail.warehouses.find((row) => row.warehouse === 'WH-002');
  assert.equal(wh2.tracked, false);
  assert.equal(wh2.counts.purchased, 0);
  assert.equal(wh2.counts.lastSoldAt, null);
  assert.ok(detail.ats && typeof detail.ats === 'object');

  await assert.rejects(skuDetail(String(other._id), String(sku._id)), { statusCode: 404 }, 'another tenant cannot open this SKU');
  await assert.rejects(skuDetail(String(tenant._id), String(otherSku._id)), { statusCode: 404 });
  await assert.rejects(skuDetail(String(tenant._id), 'not-an-id'), { statusCode: 404 });
});

test('channel listings tab: marketplaces first, then Shopify Offline, then Shopify Virtual last, each with its linked inventory', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Leheriya', slug: `leheriya-cl-${stamp}`, kind: 'merchant' });
  const other = await Tenant.create({ name: 'Other', slug: `other-cl-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `LEH-CL-${stamp}`, name: 'Pure Cotton Dress Material', mrp: 3999 });
  await listBalances(String(tenant._id));
  const offline = await Warehouse.findOne({ tenantId: tenant._id, code: 'WH-001' }).setOptions({ skipTenantFilter: true });
  const virtual = await Warehouse.findOne({ tenantId: tenant._id, code: 'WH-002' }).setOptions({ skipTenantFilter: true });
  await Inventory.create([
    { tenantId: tenant._id, masterSkuId: sku._id, warehouseId: offline._id, physicalQty: 9, reservedQty: 0, reorderPoint: 0 },
    { tenantId: tenant._id, masterSkuId: sku._id, warehouseId: virtual._id, virtualQty: 40, reservedQty: 0, reorderPoint: 0 },
  ]);
  const base = { tenantId: tenant._id, masterSkuId: sku._id, syncStatus: 'synced' };
  await SkuMapping.create([
    { ...base, channel: 'shopify', channelProductId: 'gid-p', channelVariantId: `v-${stamp}`, channelSkuCode: 'LEH-250718', channelSkuCodeNorm: 'leh-250718', channelTitle: 'Leheriya Suit', channelSellingPrice: 1999 },
    { ...base, channel: 'myntra', channelVariantId: `m-${stamp}`, channelSkuCode: '123234592', channelSkuCodeNorm: '123234592', channelTitle: 'Leheriya Pure Cotton' },
    { ...base, channel: 'amazon', channelVariantId: `a-${stamp}`, channelSkuCode: '1206FRFLBC7', channelSkuCodeNorm: '1206frflbc7', channelTitle: 'Leheriya South Cotton', channelSellingPrice: 1999 },
    { ...base, channel: 'amazon', channelVariantId: `old-${stamp}`, channelSkuCode: 'OLD', channelSkuCodeNorm: 'old', isActive: false },
    { ...base, tenantId: other._id, channel: 'amazon', channelVariantId: `x-${stamp}`, channelSkuCode: 'NOT-MINE', channelSkuCodeNorm: 'not-mine' },
  ]);

  const { listings } = await skuDetail(String(tenant._id), String(sku._id));

  assert.deepEqual(
    listings.map((row) => [row.channel, row.group, row.warehouse, row.listedQty]),
    [
      ['amazon', 'marketplace', 'WH-001', 9],
      ['myntra', 'marketplace', 'WH-001', 9],
      ['shopify', 'shopify_offline', 'WH-001', 9],
      ['shopify', 'shopify_virtual', 'WH-002', 40],
    ],
  );
  const amazon = listings[0];
  assert.equal(amazon.channelName, 'Amazon');
  assert.equal(amazon.channelSkuCode, '1206FRFLBC7');
  assert.equal(amazon.title, 'Leheriya South Cotton');
  assert.equal(amazon.sellingPrice, 1999);
  assert.equal(amazon.mrp, 3999);
  assert.equal(amazon.syncStatus, 'synced');
  assert.ok(amazon.mappedAt, 'mapped on date');
  assert.equal(listings[2].label, 'Shopify Offline');
  assert.equal(listings[3].label, 'Shopify Virtual');
});
