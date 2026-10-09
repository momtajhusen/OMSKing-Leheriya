const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const { withTransaction } = require('../src/lib/withTransaction');
const Tenant = require('../src/models/Tenant');
const Product = require('../src/models/Product');
const MasterSku = require('../src/models/MasterSku');
const Warehouse = require('../src/models/Warehouse');
const Inventory = require('../src/models/Inventory');
const InventoryLedger = require('../src/models/InventoryLedger');
const InventoryReservation = require('../src/models/InventoryReservation');
const { stockIn, stressReserve, releaseReservation, listBalances } = require('../src/services/inventory.service');

let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

test('merchant context cannot read or write another tenant', async () => {
  const stamp = Date.now();
  const a = await Tenant.create({ name: 'Tenant A', slug: `tenant-a-${stamp}`, kind: 'merchant' });
  const b = await Tenant.create({ name: 'Tenant B', slug: `tenant-b-${stamp}`, kind: 'merchant' });
  await Product.create({ tenantId: a._id, name: 'Only A' });
  await Product.create({ tenantId: b._id, name: 'Only B' });

  await als.run({ tenantId: String(a._id), skipTenantFilter: false, userId: null }, async () => {
    const rows = await Product.find({});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Only A');
    const counted = await Product.aggregate([{ $group: { _id: null, n: { $sum: 1 } } }]);
    assert.equal(counted[0].n, 1);
    await assert.rejects(
      () => Product.create({ tenantId: b._id, name: 'leak' }),
      /Cross-tenant write blocked/,
    );
  });

  await als.run({ tenantId: null, skipTenantFilter: false, userId: null }, async () => {
    await assert.rejects(() => Product.find({}), /Tenant context is required/);
  });
});

test('stock in commits qty and ledger together, and a failed transaction leaves both unchanged', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Stock', slug: `stock-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `SKU-${stamp}`, name: 'Kurta' });
  const warehouse = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Physical',
    type: 'physical',
    isDefault: true,
    sellOnShopify: true,
    sellOnAmazon: true,
    sellOnMyntra: true,
    status: 'active',
  });

  const row = await stockIn(String(tenant._id), null, {
    masterSkuId: sku._id,
    warehouseId: warehouse._id,
    qty: 4,
    reason: 'opening',
  });
  assert.equal(row.physicalQty, 4);
  const ledger = await InventoryLedger.find({ tenantId: tenant._id, movementType: 'purchase_receipt' });
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].qtyDelta, 4);
  assert.equal(ledger[0].balanceAfter, 4);

  const before = await Inventory.findOne({ tenantId: tenant._id, masterSkuId: sku._id });
  await assert.rejects(() => withTransaction(async (session) => {
    await Inventory.findOneAndUpdate(
      { _id: before._id },
      { $inc: { physicalQty: 9 } },
      { session },
    );
    throw new Error('boom before ledger');
  }));
  const after = await Inventory.findById(before._id);
  assert.equal(after.physicalQty, 4);
  const stillOne = await InventoryLedger.countDocuments({ tenantId: tenant._id });
  assert.equal(stillOne, 1);
});

test('concurrent reserve holds one unit and rejects the rest without orphan ledger rows', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Reserve', slug: `reserve-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `RSV-${stamp}`, name: 'Dupatta' });
  const physical = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Physical',
    type: 'physical',
    isDefault: true,
    sellOnShopify: true,
    sellOnAmazon: true,
    sellOnMyntra: true,
    status: 'active',
  });
  const virtual = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-002',
    name: 'Virtual',
    type: 'virtual',
    sellOnShopify: true,
    sellOnAmazon: false,
    sellOnMyntra: false,
    status: 'active',
  });
  await stockIn(String(tenant._id), null, {
    masterSkuId: sku._id,
    warehouseId: physical._id,
    qty: 1,
    reason: 'physical',
  });
  await stockIn(String(tenant._id), null, {
    masterSkuId: sku._id,
    warehouseId: virtual._id,
    qty: 1,
    reason: 'virtual',
  });

  const single = await stressReserve(String(tenant._id), null, {
    masterSkuId: sku._id,
    channel: 'amazon',
    qty: 1,
    attempts: 10,
  });
  assert.equal(single.held, 1);
  assert.equal(single.rejected, 9);

  const amazonLedger = await InventoryLedger.find({ tenantId: tenant._id, movementType: 'order_reserve', channel: 'amazon' });
  assert.equal(amazonLedger.length, 1);
  const physicalRow = await Inventory.findOne({ tenantId: tenant._id, warehouseId: physical._id });
  assert.equal(physicalRow.reservedQty, 1);
  assert.ok(physicalRow.physicalQty + physicalRow.virtualQty - physicalRow.reservedQty >= 0);

  const heldOrder = single.results.find((row) => row.ok);
  await releaseReservation(String(tenant._id), null, { orderRef: heldOrder.orderRef });

  const split = await stressReserve(String(tenant._id), null, {
    masterSkuId: sku._id,
    channel: 'shopify',
    qty: 2,
    attempts: 8,
  });
  assert.equal(split.held, 1);
  assert.equal(split.rejected, 7);

  const balances = await Inventory.find({ tenantId: tenant._id, masterSkuId: sku._id });
  const reserved = balances.reduce((sum, row) => sum + row.reservedQty, 0);
  const held = await InventoryReservation.find({ tenantId: tenant._id, status: 'held' });
  const heldQty = held.reduce((sum, row) => sum + row.qty, 0);
  assert.equal(reserved, heldQty);

  const reserves = await InventoryLedger.find({ tenantId: tenant._id, movementType: 'order_reserve' });
  const releases = await InventoryLedger.find({ tenantId: tenant._id, movementType: 'order_release' });
  for (const line of reserves) {
    const stillHeld = held.some((row) => row.orderRef === line.referenceId && String(row.warehouseId) === String(line.warehouseId));
    const released = releases.some((row) => row.referenceId === line.referenceId && String(row.warehouseId) === String(line.warehouseId));
    assert.ok(stillHeld || released, `reserve ledger ${line.referenceId} has no hold and no release`);
  }
});

test('inventory lists every master SKU at both warehouses before any receipt', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Stock view', slug: `stock-view-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `VIEW-${stamp}`, name: 'View sku' });
  const rows = await listBalances(String(tenant._id));
  const mine = rows.filter((row) => row.masterSkuId === String(sku._id));
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map((row) => row.warehouse).sort(), ['WH-001', 'WH-002']);
  assert.ok(mine.every((row) => row.tracked === false && row.stock === 0 && row.low === false));
  const physical = mine.find((row) => row.warehouse === 'WH-001');
  assert.deepEqual(physical.ats, { shopify: 0, amazon: 0, myntra: 0 });
  assert.equal(physical.channels.includes('amazon'), true);
  const virtual = mine.find((row) => row.warehouse === 'WH-002');
  assert.deepEqual(virtual.channels, ['shopify']);
  assert.equal(await Inventory.countDocuments({ tenantId: tenant._id, masterSkuId: sku._id }), 0);
});
