process.env.NODE_ENV = 'test';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const Warehouse = require('../src/models/Warehouse');
const WarehouseLocationMap = require('../src/models/WarehouseLocationMap');
const SkuMapping = require('../src/models/SkuMapping');
const Order = require('../src/models/Order');
const Inventory = require('../src/models/Inventory');
const InventoryLedger = require('../src/models/InventoryLedger');
const InventoryReservation = require('../src/models/InventoryReservation');
const IntegrationJob = require('../src/models/IntegrationJob');
const { stockIn, reserveStock } = require('../src/services/inventory.service');
const { syncOrderReservations, restockRtoOnce } = require('../src/services/orderReserve.service');
const { channelQty, runInventoryJob } = require('../src/services/inventoryPush.service');
const { ensureStockRows, reserveOpenOrders } = require('../src/services/stockBackfill.service');
const { applyTracking } = require('../src/services/tracking.service');

let replSet;

async function seller({ stock = 10 } = {}) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await Tenant.create({ name: 'Flow', slug: `flow-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `SAREE-${stamp}`, name: 'Saree' });
  const physical = await Warehouse.create({
    tenantId: tenant._id, code: 'WH-001', name: 'Main', type: 'physical', isDefault: true, isPickup: true,
    sellOnShopify: true, sellOnMyntra: true, sellOnAmazon: true, status: 'active',
  });
  await SkuMapping.create({
    tenantId: tenant._id, masterSkuId: sku._id, channel: 'myntra', channelVariantId: `myn-${stamp}`,
    channelSkuCode: 'MYN-SAREE', channelSkuCodeNorm: 'myn-saree', syncStatus: 'synced',
  });
  if (stock) await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: physical._id, qty: stock, reason: 'opening', skipNotify: true });
  return { tenantId: tenant._id, sku, physical };
}

function line(ctx, qty = 1) {
  return { name: 'Saree', sku: 'MYN-SAREE', qty, price: 500, masterSkuId: ctx.sku._id, warehouseId: ctx.physical._id };
}

async function order(ctx, orderNo, items, status = 'New') {
  return Order.create({ tenantId: ctx.tenantId, orderNo, channel: 'Myntra', externalOrderId: orderNo.replace('MYN-', ''), source: 'channel_api', status, items });
}

async function balance(ctx) {
  return Inventory.findOne({ tenantId: ctx.tenantId, masterSkuId: ctx.sku._id, warehouseId: ctx.physical._id }).setOptions({ skipTenantFilter: true }).lean();
}

async function heldQty(ctx, orderNo, status = 'held') {
  const rows = await InventoryReservation.find({ tenantId: ctx.tenantId, orderRef: orderNo, status }).setOptions({ skipTenantFilter: true }).lean();
  return rows.reduce((sum, row) => sum + row.qty, 0);
}

async function ledger(ctx, movementType, referenceId) {
  return InventoryLedger.countDocuments({ tenantId: ctx.tenantId, movementType, referenceId }).setOptions({ skipTenantFilter: true });
}

describe('order to inventory flow', () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  it('bug 1: every line with the same SKU holds its own stock (Myntra merged sub-orders), and a re-sync does not change it', async () => {
    const ctx = await seller();
    const doc = await order(ctx, 'MYN-501', [line(ctx), line(ctx), line(ctx), line(ctx), line(ctx)]);
    await syncOrderReservations(ctx.tenantId, doc);
    assert.equal(await heldQty(ctx, 'MYN-501'), 5, 'five lines of 1 hold 5, not 1');
    await syncOrderReservations(ctx.tenantId, doc);
    assert.equal(await heldQty(ctx, 'MYN-501'), 5);
    assert.equal((await balance(ctx)).reservedQty, 5);
    assert.equal(doc.reserveState, 'reserved');
  });

  it('bug 1: same SKU with different line quantities holds the sum and stays stable across syncs', async () => {
    const ctx = await seller();
    const doc = await order(ctx, 'MYN-502', [line(ctx, 2), line(ctx, 3)]);
    await syncOrderReservations(ctx.tenantId, doc);
    await syncOrderReservations(ctx.tenantId, doc);
    await syncOrderReservations(ctx.tenantId, doc);
    assert.equal(await heldQty(ctx, 'MYN-502'), 5);
    assert.equal((await balance(ctx)).reservedQty, 5);
    doc.items[1].qty = 1;
    await syncOrderReservations(ctx.tenantId, doc);
    assert.equal(await heldQty(ctx, 'MYN-502'), 3, 'a quantity change re-holds only that line');
    assert.equal((await balance(ctx)).reservedQty, 3);
  });

  it('bug 2: dispatching an order deducts its held stock once, from any status save', async () => {
    const ctx = await seller();
    const doc = await order(ctx, 'MYN-503', [line(ctx, 2)]);
    await syncOrderReservations(ctx.tenantId, doc);
    await doc.save();
    assert.equal((await balance(ctx)).physicalQty, 10);
    doc.status = 'Dispatched';
    await doc.save();
    let row = await balance(ctx);
    assert.equal(row.physicalQty, 8, 'on hand goes down on dispatch');
    assert.equal(row.reservedQty, 0);
    assert.equal(await heldQty(ctx, 'MYN-503', 'consumed'), 2);
    assert.equal(await ledger(ctx, 'fulfilment_deduct', 'MYN-503'), 1);
    doc.status = 'Delivered';
    await doc.save();
    row = await balance(ctx);
    assert.equal(row.physicalQty, 8, 'delivery does not deduct again');
    assert.equal(await ledger(ctx, 'fulfilment_deduct', 'MYN-503'), 1);
  });

  it('bug 2: an OMSKing label keeps the hold until the courier picks the parcel up', async () => {
    const ctx = await seller();
    const doc = await order(ctx, 'MYN-505', [line(ctx, 1)]);
    await syncOrderReservations(ctx.tenantId, doc);
    doc.status = 'Dispatched';
    doc.awb = 'AWB-505';
    doc.labelGeneratedAt = new Date();
    await doc.save();
    assert.equal((await balance(ctx)).physicalQty, 10, 'label alone does not deduct');
    assert.equal(await heldQty(ctx, 'MYN-505'), 1);
    await applyTracking(ctx.tenantId, { orderNo: 'MYN-505', awb: 'AWB-505', status: 'picked_up', eventKey: 'p1' });
    assert.equal((await balance(ctx)).physicalQty, 9, 'courier pickup deducts');
    assert.equal(await heldQty(ctx, 'MYN-505', 'consumed'), 1);
  });

  it('bug 2: a channel sync that moves the order to Dispatched also deducts', async () => {
    const ctx = await seller();
    const doc = await order(ctx, 'MYN-504', [line(ctx, 1), line(ctx, 1)]);
    await syncOrderReservations(ctx.tenantId, doc);
    await doc.save();
    const fresh = await Order.findById(doc._id).setOptions({ skipTenantFilter: true });
    fresh.status = 'Dispatched';
    await syncOrderReservations(ctx.tenantId, fresh);
    await fresh.save();
    assert.equal((await balance(ctx)).physicalQty, 8);
    assert.equal(await heldQty(ctx, 'MYN-504'), 0);
  });

  it('bug 3: RTO of an order that was never dispatched releases the hold and adds no stock', async () => {
    const ctx = await seller();
    const doc = await order(ctx, 'MYN-505', [line(ctx, 2)]);
    await syncOrderReservations(ctx.tenantId, doc);
    await doc.save();
    doc.status = 'RTO';
    await doc.save();
    await restockRtoOnce(ctx.tenantId, doc);
    const row = await balance(ctx);
    assert.equal(row.physicalQty, 10, 'nothing was deducted, so nothing is added back');
    assert.equal(row.reservedQty, 0, 'the hold is released');
    assert.equal(await ledger(ctx, 'rto_restock', 'MYN-505'), 0);
    assert.ok(doc.rtoRestockedAt);
  });

  it('bug 3: RTO after dispatch restocks exactly what was deducted, once', async () => {
    const ctx = await seller();
    const doc = await order(ctx, 'MYN-506', [line(ctx, 2)]);
    await syncOrderReservations(ctx.tenantId, doc);
    await doc.save();
    doc.status = 'Dispatched';
    await doc.save();
    assert.equal((await balance(ctx)).physicalQty, 8);
    doc.status = 'RTO';
    await doc.save();
    await restockRtoOnce(ctx.tenantId, doc);
    await restockRtoOnce(ctx.tenantId, doc);
    assert.equal((await balance(ctx)).physicalQty, 10);
    assert.equal(await ledger(ctx, 'rto_restock', 'MYN-506'), 1);
  });

  it('bug 3: RTO restocks a deducted line that carries only the channel SKU code', async () => {
    const ctx = await seller();
    await reserveStock(ctx.tenantId, null, {
      masterSkuId: ctx.sku._id, warehouseId: ctx.physical._id, channel: 'myntra', qty: 1, idempotencyKey: 'myn-509', orderRef: 'MYN-509',
    });
    const doc = await order(ctx, 'MYN-509', [{ name: 'Saree', sku: 'MYN-SAREE', qty: 1, price: 500 }], 'Dispatched');
    assert.equal((await balance(ctx)).physicalQty, 9);
    await restockRtoOnce(ctx.tenantId, doc);
    assert.equal((await balance(ctx)).physicalQty, 10);
    assert.equal(await ledger(ctx, 'rto_restock', 'MYN-509'), 1);
  });

  it('bug 3: RTO of an order that never held stock adds nothing', async () => {
    const ctx = await seller();
    const doc = await order(ctx, 'MYN-507', [line(ctx, 3)], 'Dispatched');
    await restockRtoOnce(ctx.tenantId, doc);
    assert.equal((await balance(ctx)).physicalQty, 10);
    assert.equal(await ledger(ctx, 'rto_restock', 'MYN-507'), 0);
  });

  it('channel push is skipped for a SKU whose stock OMSKing has never recorded, so real channel stock is not zeroed', async () => {
    const ctx = await seller({ stock: 0 });
    await Inventory.create({ tenantId: ctx.tenantId, masterSkuId: ctx.sku._id, warehouseId: ctx.physical._id });
    const job = await IntegrationJob.create({ tenantId: ctx.tenantId, channel: 'myntra', jobType: 'inventory_push', status: 'running', payload: { masterSkuId: String(ctx.sku._id) } });
    let called = false;
    const out = await runInventoryJob(job, { myntraClient: { updateInventory: async () => { called = true; return {}; } } });
    assert.equal(called, false, 'Myntra was not called');
    assert.equal(out.skipped, true);
    const saved = await IntegrationJob.findById(job._id).setOptions({ skipTenantFilter: true }).lean();
    assert.match(saved.shortSummary, /not pushed/i);
  });

  it('backfill gives every master SKU a stock row once, and a dry run changes nothing', async () => {
    const ctx = await seller();
    const extra = await MasterSku.insertMany([1, 2, 3].map((n) => ({ tenantId: ctx.tenantId, code: `EXTRA-${n}-${Date.now()}`, name: `Extra ${n}` })));
    const dry = await ensureStockRows(ctx.tenantId, { dryRun: true });
    assert.deepEqual(dry, { warehouse: 'WH-001', missing: 3, created: 0 });
    assert.equal(await Inventory.countDocuments({ tenantId: ctx.tenantId }).setOptions({ skipTenantFilter: true }), 1);
    const run = await ensureStockRows(ctx.tenantId);
    assert.equal(run.created, 3);
    assert.equal((await ensureStockRows(ctx.tenantId)).created, 0, 'second run creates nothing');
    const rows = await Inventory.find({ tenantId: ctx.tenantId, masterSkuId: { $in: extra.map((row) => row._id) } }).setOptions({ skipTenantFilter: true }).lean();
    assert.ok(rows.every((row) => !row.physicalQty && !row.reservedQty));
    assert.equal((await balance(ctx)).physicalQty, 10, 'existing stock untouched');
  });

  it('backfill reserves open orders without queueing any channel stock push', async () => {
    const ctx = await seller();
    await order(ctx, 'MYN-601', [line(ctx, 2)]);
    await order(ctx, 'MYN-602', [line(ctx, 1), line(ctx, 1)]);
    await order(ctx, 'MYN-603', [line(ctx, 1)], 'Dispatched');
    const out = await reserveOpenOrders(ctx.tenantId);
    assert.deepEqual(out, { open: 2, reserved: 2, out_of_stock: 0, unmapped: 0, failed: 0 });
    assert.equal((await balance(ctx)).reservedQty, 4);
    assert.equal(await IntegrationJob.countDocuments({ tenantId: ctx.tenantId, jobType: 'inventory_push' }).setOptions({ skipTenantFilter: true }), 0);
  });

  it('Shopify push only sends locations whose warehouse stock OMSKing has recorded', async () => {
    const ctx = await seller({ stock: 4 });
    const second = await Warehouse.create({ tenantId: ctx.tenantId, code: 'WH-003', name: 'Second', type: 'physical', sellOnShopify: true, status: 'active' });
    await WarehouseLocationMap.create({ tenantId: ctx.tenantId, warehouseId: ctx.physical._id, channel: 'shopify', externalLocationId: '111', isPrimaryForChannel: true });
    await WarehouseLocationMap.create({ tenantId: ctx.tenantId, warehouseId: second._id, channel: 'shopify', externalLocationId: '333' });
    const qty = await channelQty(ctx.tenantId, ctx.sku._id);
    const rows = qty.shopify.filter((row) => ['111', '333'].includes(row.locationId));
    assert.deepEqual(rows.map((row) => [row.locationId, row.available, row.known]), [['111', 4, true], ['333', 0, false]]);
    assert.ok(qty.shopify.filter((row) => !row.known).every((row) => row.available === 0), 'unrecorded locations are the zero ones that get skipped');
  });
});
