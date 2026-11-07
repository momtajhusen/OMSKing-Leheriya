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
const IntegrationJob = require('../src/models/IntegrationJob');
const { stockIn, stockOut } = require('../src/services/inventory.service');
const { ingestChannelOrders } = require('../src/services/channelOrder.service');
const { upsertMappedOrder, mapMyntraOrder } = require('../src/services/myntraSync.service');
const { restockRtoOnce } = require('../src/services/orderReserve.service');
const { importShopifyOpeningStock } = require('../src/services/shopifyOpeningStock.service');
const { runInventoryJob } = require('../src/services/inventoryPush.service');
const { upsertConnection } = require('../src/services/channelConnection.service');

let replSet;

async function seller() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await Tenant.create({ name: 'Gaps', slug: `gaps-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `SAREE-${stamp}`, name: 'Saree' });
  const other = await MasterSku.create({ tenantId: tenant._id, code: `DUP-${stamp}`, name: 'Dupatta' });
  const physical = await Warehouse.create({
    tenantId: tenant._id, code: 'WH-001', name: 'Main', type: 'physical', isDefault: true, isPickup: true,
    sellOnShopify: true, sellOnMyntra: true, sellOnAmazon: true, status: 'active',
  });
  for (const [code, master] of [['SAREE', sku], ['DUP', other]]) {
    await SkuMapping.create({
      tenantId: tenant._id, masterSkuId: master._id, channel: 'myntra', channelVariantId: `myntra-${code}-${stamp}`,
      channelSkuCode: code, channelSkuCodeNorm: code.toLowerCase(), syncStatus: 'synced',
    });
  }
  for (const master of [sku, other]) {
    await stockIn(String(tenant._id), null, { masterSkuId: master._id, warehouseId: physical._id, qty: 10, reason: 'opening', skipNotify: true });
  }
  return { tenantId: tenant._id, sku, other, physical };
}

const skip = (query) => query.setOptions({ skipTenantFilter: true });
const stock = (ctx, master = ctx.sku) => skip(Inventory.findOne({ tenantId: ctx.tenantId, masterSkuId: master._id, warehouseId: ctx.physical._id })).lean();
const getOrder = (ctx, orderNo) => skip(Order.findOne({ tenantId: ctx.tenantId, orderNo }));
const ledger = (ctx, movementType, referenceId) => skip(InventoryLedger.countDocuments({ tenantId: ctx.tenantId, movementType, referenceId }));

function myntra(ctx, id, status, items, extra = {}) {
  return ingestChannelOrders(ctx.tenantId, 'myntra', [{ externalOrderId: id, status, items, ...extra }]);
}

function myntraPull(ctx, id, lines) {
  const masters = new Map([
    ['SAREE', { id: String(ctx.sku._id), name: 'Saree', code: 'SAREE' }],
    ['DUP', { id: String(ctx.other._id), name: 'Dupatta', code: 'DUP' }],
  ]);
  const detail = {
    sellerOrderId: `S-${id}`,
    orderLineEntries: lines.map(([orderLineId, sku, status]) => ({ orderLineId, sku, quantity: 1, status_code: status, sellingPrice: 500 })),
  };
  return upsertMappedOrder(ctx.tenantId, mapMyntraOrder(id, [detail], masters));
}

describe('inventory gaps', () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  it('item 1: an order first seen already Dispatched takes its stock off once, and RTO puts it back', async () => {
    const ctx = await seller();
    await myntra(ctx, 'D1', 'Dispatched', [{ sku: 'SAREE', qty: 2 }]);
    let row = await stock(ctx);
    assert.equal(row.physicalQty, 8, 'shipped units leave on hand');
    assert.equal(row.reservedQty, 0);
    assert.equal(await ledger(ctx, 'fulfilment_deduct', 'MYN-D1'), 1);
    await myntra(ctx, 'D1', 'Dispatched', [{ sku: 'SAREE', qty: 2 }]);
    await myntra(ctx, 'D1', 'Delivered', [{ sku: 'SAREE', qty: 2 }]);
    row = await stock(ctx);
    assert.equal(row.physicalQty, 8, 'a re-sync does not deduct again');
    assert.equal(await ledger(ctx, 'fulfilment_deduct', 'MYN-D1'), 1);
    const doc = await getOrder(ctx, 'MYN-D1');
    doc.status = 'RTO';
    await doc.save();
    await restockRtoOnce(ctx.tenantId, doc);
    assert.equal((await stock(ctx)).physicalQty, 10, 'RTO restocks what the first sync took off');
  });

  it('item 1: an order first seen Delivered also deducts once', async () => {
    const ctx = await seller();
    await myntra(ctx, 'D2', 'Delivered', [{ sku: 'SAREE', qty: 1 }, { sku: 'DUP', qty: 1 }]);
    assert.equal((await stock(ctx)).physicalQty, 9);
    assert.equal((await stock(ctx, ctx.other)).physicalQty, 9);
  });

  it('item 1: an order placed before the SKU\'s first stock count is not deducted from counted stock', async () => {
    const ctx = await seller();
    await myntra(ctx, 'D3', 'Dispatched', [{ sku: 'SAREE', qty: 2 }], { orderDate: new Date('2020-01-01T00:00:00Z') });
    assert.equal((await stock(ctx)).physicalQty, 10);
    assert.equal(await ledger(ctx, 'fulfilment_deduct', 'MYN-D3'), 0);
  });

  it('item 1: a held order dispatched by a channel sync still deducts only through its hold', async () => {
    const ctx = await seller();
    await myntra(ctx, 'D4', 'New', [{ sku: 'SAREE', qty: 1 }]);
    await myntra(ctx, 'D4', 'Dispatched', [{ sku: 'SAREE', qty: 1 }]);
    await myntra(ctx, 'D4', 'Dispatched', [{ sku: 'SAREE', qty: 1 }]);
    const row = await stock(ctx);
    assert.equal(row.physicalQty, 9);
    assert.equal(row.reservedQty, 0);
    assert.equal(await ledger(ctx, 'fulfilment_deduct', 'MYN-D4'), 1);
  });

  it('item 2: a cancelled Myntra line frees only its own hold when another line has the same SKU', async () => {
    const ctx = await seller();
    await myntraPull(ctx, 'M1', [['L1', 'SAREE', 'WP'], ['L2', 'SAREE', 'WP']]);
    assert.equal((await stock(ctx)).reservedQty, 2);
    await myntraPull(ctx, 'M1', [['L1', 'SAREE', 'F'], ['L2', 'SAREE', 'WP']]);
    assert.equal((await stock(ctx)).reservedQty, 1, 'the cancelled line no longer holds stock');
    await myntraPull(ctx, 'M1', [['L1', 'SAREE', 'F'], ['L2', 'SAREE', 'SH']]);
    const row = await stock(ctx);
    assert.equal(row.reservedQty, 0);
    assert.equal(row.physicalQty, 9, 'only the shipped line is deducted');
    const doc = await getOrder(ctx, 'MYN-M1');
    const subs = [...doc.subOrders].sort((a, b) => a.index - b.index).map((sub) => sub.status);
    assert.deepEqual(subs, ['Cancelled', 'Dispatched'], 'each sub-order follows its own line, not the first line with its SKU');
  });

  it('item 2: a re-pull that lists the lines in another order still matches each hold to its line', async () => {
    const ctx = await seller();
    await myntraPull(ctx, 'M2', [['L1', 'SAREE', 'WP'], ['L2', 'DUP', 'WP']]);
    await myntraPull(ctx, 'M2', [['L2', 'DUP', 'WP'], ['L1', 'SAREE', 'F']]);
    assert.equal((await stock(ctx)).reservedQty, 0, 'cancelled SAREE line released');
    assert.equal((await stock(ctx, ctx.other)).reservedQty, 1, 'DUP line still held once');
  });

  it('item 3 + 4: opening stock takes one value for duplicate listings and names the SKU of failed rows', async () => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenant = await Tenant.create({ name: 'Open', slug: `open-${stamp}`, kind: 'merchant' });
    const physical = await Warehouse.create({ tenantId: tenant._id, code: 'WH-001', name: 'Main', type: 'physical', isDefault: true, status: 'active' });
    const closed = await Warehouse.create({ tenantId: tenant._id, code: 'WH-009', name: 'Closed', type: 'physical', status: 'inactive' });
    await WarehouseLocationMap.create({ tenantId: tenant._id, warehouseId: physical._id, channel: 'shopify', externalLocationId: '111' });
    await WarehouseLocationMap.create({ tenantId: tenant._id, warehouseId: closed._id, channel: 'shopify', externalLocationId: '999' });
    const master = await MasterSku.create({ tenantId: tenant._id, code: 'LEH-DUP', name: 'Dup listing' });
    const lost = await MasterSku.create({ tenantId: tenant._id, code: 'LEH-LOST', name: 'Lost' });
    for (const [variant, code, target] of [['201', 'LEH-DUP', master], ['202', 'LEH-DUP-OLD', master], ['301', 'LEH-LOST', lost]]) {
      await SkuMapping.create({
        tenantId: tenant._id, masterSkuId: target._id, channel: 'shopify', channelVariantId: variant,
        channelSkuCode: code, channelSkuCodeNorm: code.toLowerCase(), syncStatus: 'synced',
      });
    }
    const onHand = {
      111: [{ variantId: '201', onHand: 7 }, { variantId: '202', onHand: 5 }],
      999: [{ variantId: '301', onHand: 4 }],
    };
    const result = await importShopifyOpeningStock(String(tenant._id), null, { pull: async (creds, { locationId }) => onHand[locationId] || [], creds: {} });
    const row = await Inventory.findOne({ tenantId: tenant._id, masterSkuId: master._id, warehouseId: physical._id }).lean();
    assert.equal(row.physicalQty, 7, 'two listings of one SKU at one location are not added together');
    assert.equal(result.conflicts.length, 1);
    assert.match(JSON.stringify(result.conflicts[0]), /LEH-DUP/);
    assert.match(JSON.stringify(result.conflicts[0]), /7/);
    assert.match(JSON.stringify(result.conflicts[0]), /5/);
    assert.equal(result.failed, 1);
    assert.match(result.errors[0], /LEH-LOST/, 'the failure names the SKU');
  });

  it('item 5: a line qty edited down shrinks its hold', async () => {
    const ctx = await seller();
    await myntra(ctx, 'Q1', 'New', [{ sku: 'SAREE', qty: 3 }]);
    assert.equal((await stock(ctx)).reservedQty, 3);
    await myntra(ctx, 'Q1', 'New', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await stock(ctx)).reservedQty, 1);
  });

  it('item 5: a removed line with the same SKU as a kept line releases exactly one hold', async () => {
    const ctx = await seller();
    await myntra(ctx, 'Q2', 'New', [{ sku: 'SAREE', qty: 1 }, { sku: 'SAREE', qty: 1 }]);
    assert.equal((await stock(ctx)).reservedQty, 2);
    await myntra(ctx, 'Q2', 'New', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await stock(ctx)).reservedQty, 1);
  });

  it('item 5: a SKU remapped after the hold moves the hold to the new master', async () => {
    const ctx = await seller();
    await myntra(ctx, 'Q3', 'New', [{ sku: 'SAREE', qty: 2 }]);
    await SkuMapping.updateOne({ tenantId: ctx.tenantId, channel: 'myntra', channelSkuCode: 'SAREE' }, { $set: { masterSkuId: ctx.other._id } });
    await myntra(ctx, 'Q3', 'New', [{ sku: 'SAREE', qty: 2 }]);
    await myntra(ctx, 'Q3', 'New', [{ sku: 'SAREE', qty: 2 }]);
    assert.equal((await stock(ctx)).reservedQty, 0);
    assert.equal((await stock(ctx, ctx.other)).reservedQty, 2);
  });

  it('item 5: an order un-cancelled by the channel holds its stock again, once', async () => {
    const ctx = await seller();
    await myntra(ctx, 'Q4', 'New', [{ sku: 'SAREE', qty: 1 }]);
    await myntra(ctx, 'Q4', 'Cancelled', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await stock(ctx)).reservedQty, 0);
    await myntra(ctx, 'Q4', 'New', [{ sku: 'SAREE', qty: 1 }]);
    await myntra(ctx, 'Q4', 'New', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await stock(ctx)).reservedQty, 1);
    assert.equal(await ledger(ctx, 'order_reserve', 'MYN-Q4'), 2, 'one reserve before the cancel, one after');
  });

  it('item 5: channel-only stock held by a removed line is given back to that channel', async () => {
    const ctx = await seller();
    await skip(Inventory.updateOne({ tenantId: ctx.tenantId, masterSkuId: ctx.sku._id, warehouseId: ctx.physical._id }, { $set: { 'channelOnly.myntra': 2 } }));
    await myntra(ctx, 'Q5', 'New', [{ sku: 'SAREE', qty: 1 }, { sku: 'DUP', qty: 1 }]);
    assert.equal((await stock(ctx)).channelHeld.myntra, 1);
    await myntra(ctx, 'Q5', 'New', [{ sku: 'DUP', qty: 1 }]);
    const row = await stock(ctx);
    assert.equal(row.channelHeld.myntra, 0);
    assert.equal(row.reservedQty, 0);
  });

  it('item 6: a push that lands after a newer push is corrected from a fresh read', async () => {
    const ctx = await seller();
    await upsertConnection(ctx.tenantId, null, 'myntra', { credentials: { merchantId: 'M1', secretKey: 'S1', storeId: 'STORE1', apiMode: 'live' } });
    const arrivals = [];
    let reached;
    const atChannel = new Promise((resolve) => { reached = resolve; });
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    let first = true;
    const slowClient = {
      updateInventory: async (items) => {
        if (first) {
          first = false;
          reached();
          await gate;
        }
        arrivals.push(items[0].quantity);
        return [];
      },
    };
    const fastClient = { updateInventory: async (items) => { arrivals.push(items[0].quantity); return []; } };
    const job = () => IntegrationJob.create({ tenantId: ctx.tenantId, channel: 'myntra', jobType: 'inventory_push', status: 'running', payload: { masterSkuId: String(ctx.sku._id) } });
    const slow = runInventoryJob(await job(), { myntraClient: slowClient });
    await atChannel;
    await stockOut(String(ctx.tenantId), null, { masterSkuId: ctx.sku._id, warehouseId: ctx.physical._id, qty: 3, reason: 'damaged' });
    await runInventoryJob(await job(), { myntraClient: fastClient });
    open();
    await slow;
    assert.deepEqual(arrivals.slice(0, 2), [7, 10], 'the slow stale push landed after the fresh one');
    assert.equal(arrivals[arrivals.length - 1], 7, 'the last value on Myntra is the current stock');
  });
});
