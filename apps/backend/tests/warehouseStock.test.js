const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const Inventory = require('../src/models/Inventory');
const InventoryLedger = require('../src/models/InventoryLedger');
const InventoryReservation = require('../src/models/InventoryReservation');
const Order = require('../src/models/Order');
const shopify = require('../src/adapters/shopify');
const { stockIn, stockOut, reserveStock, releaseReservation, setChannelAvailable, availableOf } = require('../src/services/inventory.service');
const { ensureDefaultWarehouses, warehousesForChannel } = require('../src/services/warehouse.service');
const { ingestChannelOrders } = require('../src/services/channelOrder.service');
const { channelQty } = require('../src/services/inventoryPush.service');

let replSet;

function shopifyOrder(id) {
  return shopify.mapShopifyOrder({
    id,
    financial_status: 'paid',
    fulfillment_status: null,
    payment_gateway_names: ['Cash on Delivery'],
    total_price: '499.00',
    created_at: '2026-10-01T00:00:00.000Z',
    line_items: [{ title: 'Kurta', sku: 'KURTA', quantity: 1, price: '499.00' }],
  }, {});
}

async function seller() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await Tenant.create({ name: 'Stock', slug: `stock-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `KURTA-${stamp}`, name: 'Kurta' });
  const { physical, virtual } = await ensureDefaultWarehouses(tenant._id);
  await SkuMapping.create({
    tenantId: tenant._id,
    masterSkuId: sku._id,
    channel: 'shopify',
    channelVariantId: `var-${stamp}`,
    channelSkuCode: 'KURTA',
    channelSkuCodeNorm: 'kurta',
    syncStatus: 'synced',
  });
  await stockIn(String(tenant._id), null, {
    masterSkuId: sku._id,
    warehouseId: physical._id,
    qty: 1,
    reason: 'last piece',
  });
  return { tenant, sku, physical, virtual };
}

function nonNegative(row) {
  assert.ok(row.physicalQty >= 0, `physicalQty ${row.physicalQty}`);
  assert.ok(row.virtualQty >= 0, `virtualQty ${row.virtualQty}`);
  assert.ok(row.reservedQty >= 0, `reservedQty ${row.reservedQty}`);
  assert.ok(availableOf(row) >= 0, `available ${availableOf(row)}`);
}

describe('warehouse stock', () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  it('reserves one piece and leaves every other order out of stock for 2 to 10 concurrent orders', async () => {
    const { tenant, physical } = await seller();
    const id = String(tenant._id);
    for (let n = 2; n <= 10; n += 1) {
      await InventoryReservation.deleteMany({ tenantId: tenant._id });
      await Inventory.updateMany(
        { tenantId: tenant._id },
        { $set: { physicalQty: 0, virtualQty: 0, reservedQty: 0 } },
      ).setOptions({ skipTenantFilter: true });
      await Inventory.updateOne(
        { tenantId: tenant._id, warehouseId: physical._id },
        { $set: { physicalQty: 1, reservedQty: 0 } },
      ).setOptions({ skipTenantFilter: true });

      const base = n * 1000;
      const results = await Promise.all(Array.from({ length: n }, (_, index) => (
        ingestChannelOrders(id, 'shopify', [shopifyOrder(base + index)])
          .then(() => ({ ok: true }))
          .catch((err) => ({ ok: false, message: err.message, status: err.statusCode }))
      )));
      assert.equal(results.every((row) => row.ok), true, results.map((row) => row.message).join('; '));

      const orders = await Order.find({
        tenantId: tenant._id,
        externalOrderId: { $in: Array.from({ length: n }, (_, index) => String(base + index)) },
      }).setOptions({ skipTenantFilter: true });
      assert.equal(orders.length, n);
      const reserved = orders.filter((row) => row.reserveState === 'reserved');
      const out = orders.filter((row) => row.reserveState === 'out_of_stock');
      assert.equal(reserved.length, 1, `n=${n} reserved ${reserved.length}`);
      assert.equal(out.length, n - 1, `n=${n} out ${out.length}`);

      const rows = await Inventory.find({ tenantId: tenant._id }).setOptions({ skipTenantFilter: true });
      rows.forEach(nonNegative);
      const physicalRow = rows.find((row) => String(row.warehouseId) === String(physical._id));
      assert.equal(physicalRow.reservedQty, 1);
      assert.equal(physicalRow.physicalQty, 1);
      const holds = await InventoryReservation.find({ tenantId: tenant._id, status: 'held' }).setOptions({ skipTenantFilter: true });
      assert.equal(holds.length, 1);
      assert.equal(holds[0].qty, 1);
      const refs = orders.map((row) => row.orderNo);
      const reserveRows = await InventoryLedger.countDocuments({
        tenantId: tenant._id,
        movementType: 'order_reserve',
        referenceId: { $in: refs },
      });
      const releaseRows = await InventoryLedger.countDocuments({
        tenantId: tenant._id,
        movementType: 'order_release',
        referenceId: { $in: refs },
      });
      assert.equal(reserveRows - releaseRows, 1);
    }
  });

  it('does not let a stock-out or a channel qty write drive quantity negative', async () => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenant = await Tenant.create({ name: 'Nonneg', slug: `nonneg-${stamp}`, kind: 'merchant' });
    const sku = await MasterSku.create({ tenantId: tenant._id, code: `NN-${stamp}`, name: 'Piece' });
    const { physical } = await ensureDefaultWarehouses(tenant._id);
    await stockIn(String(tenant._id), null, {
      masterSkuId: sku._id,
      warehouseId: physical._id,
      qty: 1,
      reason: 'one',
    });
    await Inventory.updateOne(
      { tenantId: tenant._id, warehouseId: physical._id },
      { $set: { virtualQty: 6 } },
    ).setOptions({ skipTenantFilter: true });

    await assert.rejects(
      () => stockOut(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: physical._id, qty: 2, reason: 'too many' }),
      (err) => err.statusCode === 409,
    );
    const afterOut = await Inventory.findOne({ tenantId: tenant._id, warehouseId: physical._id }).setOptions({ skipTenantFilter: true });
    nonNegative(afterOut);
    assert.equal(afterOut.physicalQty, 1);

    await setChannelAvailable(String(tenant._id), null, {
      masterSkuId: sku._id,
      warehouseId: physical._id,
      available: 0,
      reason: 'zero the shelf',
    });
    const afterSet = await Inventory.findOne({ tenantId: tenant._id, warehouseId: physical._id }).setOptions({ skipTenantFilter: true });
    nonNegative(afterSet);
  });

  it('keeps quantity at the target when two channel writes race', async () => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenant = await Tenant.create({ name: 'Race write', slug: `race-write-${stamp}`, kind: 'merchant' });
    const sku = await MasterSku.create({ tenantId: tenant._id, code: `RW-${stamp}`, name: 'Race' });
    const { physical } = await ensureDefaultWarehouses(tenant._id);
    await stockIn(String(tenant._id), null, {
      masterSkuId: sku._id,
      warehouseId: physical._id,
      qty: 6,
      reason: 'six',
    });
    await Promise.all([
      setChannelAvailable(String(tenant._id), null, {
        masterSkuId: sku._id, warehouseId: physical._id, available: 4, reason: 'a',
      }),
      setChannelAvailable(String(tenant._id), null, {
        masterSkuId: sku._id, warehouseId: physical._id, available: 4, reason: 'b',
      }),
    ]);
    const row = await Inventory.findOne({ tenantId: tenant._id, warehouseId: physical._id }).setOptions({ skipTenantFilter: true });
    nonNegative(row);
    assert.equal(row.physicalQty, 4);
    assert.equal(availableOf(row), 4);
  });

  it('shows Shopify WH-001 plus WH-002, and Amazon and Myntra WH-001 only', async () => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenant = await Tenant.create({ name: 'ATS', slug: `ats-${stamp}`, kind: 'merchant' });
    const sku = await MasterSku.create({ tenantId: tenant._id, code: `ATS-${stamp}`, name: 'Ats' });
    const { physical, virtual } = await ensureDefaultWarehouses(tenant._id);
    await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: physical._id, qty: 4, reason: 'physical' });
    await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: virtual._id, qty: 1000, reason: 'virtual' });

    const shopifyWarehouses = (await warehousesForChannel(tenant._id, 'shopify')).map((row) => row.code).sort();
    const amazonWarehouses = (await warehousesForChannel(tenant._id, 'amazon')).map((row) => row.code);
    const myntraWarehouses = (await warehousesForChannel(tenant._id, 'myntra')).map((row) => row.code);
    assert.deepEqual(shopifyWarehouses, ['WH-001', 'WH-002']);
    assert.deepEqual(amazonWarehouses, ['WH-001']);
    assert.deepEqual(myntraWarehouses, ['WH-001']);

    const qty = await channelQty(tenant._id, sku._id);
    const byCode = Object.fromEntries(qty.shopify.map((row) => [row.warehouseCode, row.available]));
    assert.equal(byCode['WH-001'], 4);
    assert.equal(byCode['WH-002'], 1000);
    assert.equal(qty.byChannel.shopify, 1004);
    assert.equal(qty.amazon, 4);
    assert.equal(qty.myntra, 4);
    assert.equal(qty.byChannel.amazon, 4);
    assert.equal(qty.byChannel.myntra, 4);

    await reserveStock(String(tenant._id), null, {
      masterSkuId: sku._id,
      channel: 'amazon',
      qty: 1,
      idempotencyKey: `ats-${stamp}`,
      orderRef: `ATS-${stamp}`,
    });
    const after = await channelQty(tenant._id, sku._id);
    const afterByCode = Object.fromEntries(after.shopify.map((row) => [row.warehouseCode, row.available]));
    assert.equal(afterByCode['WH-001'], 3);
    assert.equal(afterByCode['WH-002'], 1000);
    assert.equal(after.amazon, 3);
    assert.equal(after.myntra, 3);
    await releaseReservation(String(tenant._id), null, { orderRef: `ATS-${stamp}` });
  });
});
