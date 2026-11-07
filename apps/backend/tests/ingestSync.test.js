process.env.NODE_ENV = 'test';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const Warehouse = require('../src/models/Warehouse');
const SkuMapping = require('../src/models/SkuMapping');
const Order = require('../src/models/Order');
const Inventory = require('../src/models/Inventory');
const InventoryReservation = require('../src/models/InventoryReservation');
const { stockIn } = require('../src/services/inventory.service');
const { ingestChannelOrders } = require('../src/services/channelOrder.service');
const { upsertMappedOrder } = require('../src/services/myntraSync.service');
const { linkOpenOrders } = require('../src/services/catalogMapping.service');
const { mapShopifyOrder } = require('../src/adapters/shopify');

let replSet;

async function seller() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await Tenant.create({ name: 'Ingest', slug: `ing-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `SAREE-${stamp}`, name: 'Saree' });
  const other = await MasterSku.create({ tenantId: tenant._id, code: `DUP-${stamp}`, name: 'Dupatta' });
  const physical = await Warehouse.create({
    tenantId: tenant._id, code: 'WH-001', name: 'Main', type: 'physical', isDefault: true, isPickup: true,
    sellOnShopify: true, sellOnMyntra: true, sellOnAmazon: true, status: 'active',
  });
  for (const [channel, code, master] of [['myntra', 'SAREE', sku], ['myntra', 'DUP', other]]) {
    await SkuMapping.create({
      tenantId: tenant._id, masterSkuId: master._id, channel, channelVariantId: `${channel}-${code}-${stamp}`,
      channelSkuCode: code, channelSkuCodeNorm: code.toLowerCase(), syncStatus: 'synced',
    });
  }
  for (const master of [sku, other]) {
    await stockIn(String(tenant._id), null, { masterSkuId: master._id, warehouseId: physical._id, qty: 10, reason: 'opening', skipNotify: true });
  }
  return { tenantId: tenant._id, sku, other, physical };
}

async function stock(ctx, master = ctx.sku) {
  return Inventory.findOne({ tenantId: ctx.tenantId, masterSkuId: master._id, warehouseId: ctx.physical._id }).setOptions({ skipTenantFilter: true }).lean();
}

const getOrder = (ctx, orderNo) => Order.findOne({ tenantId: ctx.tenantId, orderNo }).setOptions({ skipTenantFilter: true });

function myntra(ctx, id, status, items) {
  return ingestChannelOrders(ctx.tenantId, 'myntra', [{ externalOrderId: id, status, items }]);
}

describe('channel order sync keeps OMS state', () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  it('a stale re-sync after dispatch neither moves the order back nor reserves and deducts again', async () => {
    const ctx = await seller();
    await myntra(ctx, '1', 'New', [{ sku: 'SAREE', qty: 1 }]);
    const doc = await getOrder(ctx, 'MYN-1');
    doc.status = 'Dispatched';
    await doc.save();
    assert.equal((await stock(ctx)).physicalQty, 9);
    await myntra(ctx, '1', 'New', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await getOrder(ctx, 'MYN-1')).status, 'Dispatched');
    assert.equal((await stock(ctx)).reservedQty, 0);
    await myntra(ctx, '1', 'Dispatched', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await stock(ctx)).physicalQty, 9, 'deducted once');
  });

  it('a re-sync does not undo OMS Packed or revive an OMS-cancelled order', async () => {
    const ctx = await seller();
    await myntra(ctx, '2', 'New', [{ sku: 'SAREE', qty: 1 }]);
    const doc = await getOrder(ctx, 'MYN-2');
    doc.status = 'Packed';
    await doc.save();
    await myntra(ctx, '2', 'New', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await getOrder(ctx, 'MYN-2')).status, 'Packed');
    await myntra(ctx, '3', 'New', [{ sku: 'SAREE', qty: 1 }]);
    const cancelled = await getOrder(ctx, 'MYN-3');
    cancelled.status = 'Cancelled';
    cancelled.cancelSource = 'oms';
    await cancelled.save();
    await myntra(ctx, '3', 'New', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await getOrder(ctx, 'MYN-3')).status, 'Cancelled');
    assert.equal((await stock(ctx)).reservedQty, 1, 'only MYN-2 holds stock');
  });

  it('a channel cancel after dispatch keeps the order dispatched; before dispatch it cancels and frees the hold', async () => {
    const ctx = await seller();
    await myntra(ctx, '4', 'New', [{ sku: 'SAREE', qty: 1 }]);
    const doc = await getOrder(ctx, 'MYN-4');
    doc.status = 'Dispatched';
    await doc.save();
    await myntra(ctx, '4', 'Cancelled', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await getOrder(ctx, 'MYN-4')).status, 'Dispatched');
    await myntra(ctx, '5', 'New', [{ sku: 'SAREE', qty: 1 }]);
    await myntra(ctx, '5', 'Cancelled', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await getOrder(ctx, 'MYN-5')).status, 'Cancelled');
    assert.equal((await stock(ctx)).reservedQty, 0);
  });

  it('removing a line on the channel releases that line\'s hold', async () => {
    const ctx = await seller();
    await myntra(ctx, '6', 'New', [{ sku: 'DUP', qty: 1 }, { sku: 'SAREE', qty: 2 }]);
    assert.equal((await stock(ctx)).reservedQty, 2);
    await myntra(ctx, '6', 'New', [{ sku: 'SAREE', qty: 2 }]);
    assert.equal((await stock(ctx, ctx.other)).reservedQty, 0, 'removed line freed');
    assert.equal((await stock(ctx)).reservedQty, 2, 'remaining line still held once');
  });

  it('a SKU re-mapped to another master moves the hold to the new master', async () => {
    const ctx = await seller();
    await myntra(ctx, '7', 'New', [{ sku: 'SAREE', qty: 1 }]);
    await SkuMapping.updateOne({ tenantId: ctx.tenantId, channel: 'myntra', channelSkuCode: 'SAREE' }, { $set: { masterSkuId: ctx.other._id } });
    await myntra(ctx, '7', 'New', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await stock(ctx)).reservedQty, 0);
    assert.equal((await stock(ctx, ctx.other)).reservedQty, 1);
  });

  it('an order first seen at Ready to Ship holds its stock', async () => {
    const ctx = await seller();
    await myntra(ctx, '8', 'Ready to Ship', [{ sku: 'SAREE', qty: 1 }]);
    assert.equal((await stock(ctx)).reservedQty, 1);
  });

  it('mapping a SKU later reserves its open orders on that channel only', async () => {
    const ctx = await seller();
    await ingestChannelOrders(ctx.tenantId, 'amazon', [{ externalOrderId: 'A9', status: 'New', items: [{ sku: 'NEW-SKU', qty: 1 }] }]);
    await myntra(ctx, '9', 'New', [{ sku: 'NEW-SKU', qty: 1 }]);
    const mapping = await SkuMapping.create({
      tenantId: ctx.tenantId, masterSkuId: ctx.sku._id, channel: 'amazon', channelVariantId: 'amz-new', channelSkuCode: 'NEW-SKU', channelSkuCodeNorm: 'new-sku', syncStatus: 'synced',
    });
    await linkOpenOrders(ctx.tenantId, mapping);
    const amazon = await Order.findOne({ tenantId: ctx.tenantId, channel: 'Amazon', externalOrderId: 'A9' }).setOptions({ skipTenantFilter: true });
    assert.equal(amazon.reserveState, 'reserved');
    assert.equal((await stock(ctx)).reservedQty, 1);
    assert.equal((await getOrder(ctx, 'MYN-9')).items[0].masterSkuId, null, 'Myntra order untouched by an Amazon mapping');
  });

  it('a Myntra order already stored under another number updates instead of crashing', async () => {
    const ctx = await seller();
    await Order.create({ tenantId: ctx.tenantId, orderNo: 'MYN-OLDKEY', channel: 'Myntra', externalOrderId: 'X10', status: 'New', items: [{ sku: 'SAREE', qty: 1 }] });
    const out = await upsertMappedOrder(ctx.tenantId, {
      orderNo: 'MYN-X10', externalOrderId: 'X10', channel: 'Myntra', status: 'Processing',
      channelLines: [{ sellerOrderId: 'S10', sku: 'SAREE', status: 'WP' }],
      items: [{ sku: 'SAREE', name: 'Saree', qty: 1, masterSkuId: ctx.sku._id }],
    });
    assert.ok(['updated', 'unchanged'].includes(out));
  });

  it('a Myntra RTO after dispatch puts the shipped stock back once', async () => {
    const ctx = await seller();
    const mapped = (status) => ({
      orderNo: 'MYN-X11', externalOrderId: 'X11', channel: 'Myntra', status: 'New',
      channelLines: [{ sellerOrderId: 'S11', sku: 'SAREE', status }],
      items: [{ sku: 'SAREE', name: 'Saree', qty: 1, masterSkuId: ctx.sku._id, warehouseId: ctx.physical._id }],
    });
    await upsertMappedOrder(ctx.tenantId, mapped('Q'));
    await upsertMappedOrder(ctx.tenantId, mapped('SH'));
    assert.equal((await stock(ctx)).physicalQty, 9);
    await upsertMappedOrder(ctx.tenantId, mapped('RTO'));
    await upsertMappedOrder(ctx.tenantId, mapped('RTO'));
    assert.equal((await stock(ctx)).physicalQty, 10);
    assert.equal((await getOrder(ctx, 'MYN-X11')).status, 'Dispatched');
  });

  it('Shopify lines use the current quantity after an order edit, and removed lines drop out', () => {
    const mapped = mapShopifyOrder({
      id: 5, line_items: [
        { sku: 'A', quantity: 2, current_quantity: 1, price: '10' },
        { sku: 'B', quantity: 1, current_quantity: 0, price: '10' },
      ],
    }, {});
    assert.deepEqual(mapped.items.map((item) => [item.sku, item.qty]), [['A', 1]]);
  });
});
