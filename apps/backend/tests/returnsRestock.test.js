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
const InventoryLedger = require('../src/models/InventoryLedger');
const CustomerReturn = require('../src/models/CustomerReturn');
const { stockIn } = require('../src/services/inventory.service');
const { syncOrderReservations, restockRtoOnce } = require('../src/services/orderReserve.service');
const { receiveReturn, updateRefund, restockOrderReturn } = require('../src/services/returnsFlow.service');
const { returnRowsFromOrders } = require('../src/adapters/shopify');

let replSet;

async function seller() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await Tenant.create({ name: 'Ret', slug: `ret-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `SAREE-${stamp}`, name: 'Saree' });
  const other = await MasterSku.create({ tenantId: tenant._id, code: `DUPATTA-${stamp}`, name: 'Dupatta' });
  const physical = await Warehouse.create({
    tenantId: tenant._id, code: 'WH-001', name: 'Main', type: 'physical', isDefault: true, isPickup: true,
    sellOnShopify: true, sellOnMyntra: true, sellOnAmazon: true, status: 'active',
  });
  await SkuMapping.create({
    tenantId: tenant._id, masterSkuId: sku._id, channel: 'myntra', channelVariantId: `myn-${stamp}`,
    channelSkuCode: 'MYN-SAREE', channelSkuCodeNorm: 'myn-saree', syncStatus: 'synced',
  });
  await SkuMapping.create({
    tenantId: tenant._id, masterSkuId: other._id, channel: 'myntra', channelVariantId: `myn-d-${stamp}`,
    channelSkuCode: 'MYN-DUPATTA', channelSkuCodeNorm: 'myn-dupatta', syncStatus: 'synced',
  });
  await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: physical._id, qty: 10, reason: 'opening', skipNotify: true });
  await stockIn(String(tenant._id), null, { masterSkuId: other._id, warehouseId: physical._id, qty: 10, reason: 'opening', skipNotify: true });
  return { tenantId: tenant._id, sku, other, physical };
}

function line(ctx, qty = 1) {
  return { name: 'Saree', sku: 'MYN-SAREE', qty, price: 500, masterSkuId: ctx.sku._id, warehouseId: ctx.physical._id };
}

async function dispatched(ctx, orderNo, qty = 1) {
  const doc = await Order.create({ tenantId: ctx.tenantId, orderNo, channel: 'Myntra', externalOrderId: orderNo, source: 'channel_api', status: 'New', items: [line(ctx, qty)] });
  await syncOrderReservations(ctx.tenantId, doc, { notify: false });
  doc.status = 'Dispatched';
  await doc.save();
  return doc;
}

async function onHand(ctx, sku = ctx.sku) {
  const row = await Inventory.findOne({ tenantId: ctx.tenantId, masterSkuId: sku._id, warehouseId: ctx.physical._id }).setOptions({ skipTenantFilter: true }).lean();
  return row.physicalQty;
}

async function approvedReturn(ctx, returnNo, orderNo, items, extra = {}) {
  return CustomerReturn.create({ tenantId: ctx.tenantId, returnNo, orderNo, channel: 'Myntra', status: 'Approved', items, ...extra });
}

describe('returns and RTO restock only what left the warehouse', () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  it('receiving the same return twice at once restocks it once', async () => {
    const ctx = await seller();
    await dispatched(ctx, 'R-1');
    await approvedReturn(ctx, 'RET-1', 'R-1', [{ sku: 'MYN-SAREE', qty: 1 }]);
    const results = await Promise.allSettled([
      receiveReturn(ctx.tenantId, null, 'RET-1'),
      receiveReturn(ctx.tenantId, null, 'RET-1'),
    ]);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(await onHand(ctx), 10, '10 - 1 shipped + 1 returned');
    assert.equal((await CustomerReturn.findOne({ tenantId: ctx.tenantId, returnNo: 'RET-1' }).setOptions({ skipTenantFilter: true })).status, 'Completed');
  });

  it('a return received before the RTO is not restocked again by the RTO', async () => {
    const ctx = await seller();
    const doc = await dispatched(ctx, 'R-2');
    await approvedReturn(ctx, 'RET-2', 'R-2', [{ sku: 'MYN-SAREE', qty: 1 }], { kind: 'rto' });
    await receiveReturn(ctx.tenantId, null, 'RET-2');
    await restockRtoOnce(ctx.tenantId, doc);
    await doc.save();
    assert.equal(await onHand(ctx), 10);
  });

  it('two RTO events at once restock once', async () => {
    const ctx = await seller();
    await dispatched(ctx, 'R-3', 2);
    const a = await Order.findOne({ tenantId: ctx.tenantId, orderNo: 'R-3' }).setOptions({ skipTenantFilter: true });
    const b = await Order.findOne({ tenantId: ctx.tenantId, orderNo: 'R-3' }).setOptions({ skipTenantFilter: true });
    await Promise.all([restockRtoOnce(ctx.tenantId, a), restockRtoOnce(ctx.tenantId, b)]);
    assert.equal(await onHand(ctx), 10);
  });

  it('a return on an order cancelled before dispatch restocks nothing', async () => {
    const ctx = await seller();
    const doc = await Order.create({ tenantId: ctx.tenantId, orderNo: 'R-4', channel: 'Myntra', externalOrderId: 'R-4', status: 'New', items: [line(ctx)] });
    await syncOrderReservations(ctx.tenantId, doc, { notify: false });
    doc.status = 'Cancelled';
    await syncOrderReservations(ctx.tenantId, doc, { notify: false });
    await doc.save();
    await approvedReturn(ctx, 'RET-4', 'R-4', [{ sku: 'MYN-SAREE', qty: 1 }]);
    await receiveReturn(ctx.tenantId, null, 'RET-4');
    assert.equal(await onHand(ctx), 10);
  });

  it('returns never restock more than shipped, nor a SKU that was not on the order', async () => {
    const ctx = await seller();
    await dispatched(ctx, 'R-5', 2);
    await approvedReturn(ctx, 'RET-5A', 'R-5', [{ sku: 'MYN-SAREE', qty: 3 }, { sku: 'MYN-DUPATTA', qty: 1 }]);
    await receiveReturn(ctx.tenantId, null, 'RET-5A');
    assert.equal(await onHand(ctx), 10, 'capped at the 2 shipped');
    assert.equal(await onHand(ctx, ctx.other), 10, 'dupatta was never on the order');
    await approvedReturn(ctx, 'RET-5B', 'R-5', [{ sku: 'MYN-SAREE', qty: 1 }]);
    await receiveReturn(ctx.tenantId, null, 'RET-5B');
    assert.equal(await onHand(ctx), 10, 'nothing left to return');
  });

  it('a return with an unmapped SKU is refused and stays open, with nothing restocked', async () => {
    const ctx = await seller();
    await dispatched(ctx, 'R-6');
    await approvedReturn(ctx, 'RET-6', 'R-6', [{ sku: 'MYN-SAREE', qty: 1 }, { sku: 'NO-SUCH-SKU', qty: 1 }]);
    await assert.rejects(receiveReturn(ctx.tenantId, null, 'RET-6'), /NO-SUCH-SKU/);
    assert.equal(await onHand(ctx), 9);
    assert.equal((await CustomerReturn.findOne({ tenantId: ctx.tenantId, returnNo: 'RET-6' }).setOptions({ skipTenantFilter: true })).status, 'Approved');
  });

  it('a rejected return cannot be received', async () => {
    const ctx = await seller();
    await dispatched(ctx, 'R-7');
    await approvedReturn(ctx, 'RET-7', 'R-7', [{ sku: 'MYN-SAREE', qty: 1 }], { status: 'Rejected' });
    await assert.rejects(receiveReturn(ctx.tenantId, null, 'RET-7'), /rejected/i);
    assert.equal(await onHand(ctx), 9);
  });

  it('an order shipped before stock was first counted restocks on return; one shipped after without a deduct does not', async () => {
    const ctx = await seller();
    const old = new Date(Date.now() - 7 * 86400000);
    await Order.create({ tenantId: ctx.tenantId, orderNo: 'R-8A', channel: 'Myntra', status: 'Delivered', awb: 'A1', orderDate: old, items: [line(ctx)] });
    await approvedReturn(ctx, 'RET-8A', 'R-8A', [{ sku: 'MYN-SAREE', qty: 1 }]);
    await receiveReturn(ctx.tenantId, null, 'RET-8A');
    assert.equal(await onHand(ctx), 11, 'the opening count was taken after it shipped');
    await Order.create({ tenantId: ctx.tenantId, orderNo: 'R-8B', channel: 'Myntra', status: 'Delivered', awb: 'A2', items: [line(ctx)] });
    await approvedReturn(ctx, 'RET-8B', 'R-8B', [{ sku: 'MYN-SAREE', qty: 1 }]);
    await receiveReturn(ctx.tenantId, null, 'RET-8B');
    assert.equal(await onHand(ctx), 11, 'never deducted, so nothing to add back');
  });

  it('a refund cannot exceed the returned value and a refunded return cannot be reopened', async () => {
    const ctx = await seller();
    await dispatched(ctx, 'R-9', 2);
    await approvedReturn(ctx, 'RET-9A', 'R-9', [{ sku: 'MYN-SAREE', qty: 1 }]);
    await approvedReturn(ctx, 'RET-9B', 'R-9', [{ sku: 'MYN-SAREE', qty: 2 }]);
    await assert.rejects(updateRefund(ctx.tenantId, 'RET-9A', { status: 'refunded', amount: 501 }), /500/);
    await updateRefund(ctx.tenantId, 'RET-9A', { status: 'refunded', amount: 500 });
    await assert.rejects(updateRefund(ctx.tenantId, 'RET-9A', { status: 'pending' }), /already refunded/i);
    await assert.rejects(updateRefund(ctx.tenantId, 'RET-9B', { status: 'refunded', amount: 1000 }), /500/, 'order total 1000, 500 already refunded');
  });

  it('a Shopify refund with no returned lines does not become a return', () => {
    const rows = returnRowsFromOrders([{
      id: 77,
      line_items: [{ sku: 'K', quantity: 2, name: 'Kurta' }],
      refunds: [{ id: 1, refund_line_items: [] }, { id: 2, refund_line_items: [{ quantity: 1, line_item: { sku: 'K', name: 'Kurta' } }] }],
    }]);
    assert.deepEqual(rows.map((row) => row.returnNo), ['SHP-RET-2']);
    assert.equal(rows[0].items[0].qty, 1);
  });

  it('the manual restock button is capped by the order and repeat clicks add nothing', async () => {
    const ctx = await seller();
    await dispatched(ctx, 'R-10');
    await assert.rejects(restockOrderReturn(ctx.tenantId, null, { referenceId: 'RP-10', items: [{ sku: 'MYN-SAREE', qty: 1 }] }), /order/i);
    const body = { orderNo: 'R-10', referenceId: 'RP-10', items: [{ sku: 'MYN-SAREE', qty: 5 }], movementType: 'purchase_receipt' };
    await restockOrderReturn(ctx.tenantId, null, body);
    await restockOrderReturn(ctx.tenantId, null, body);
    assert.equal(await onHand(ctx), 10);
    const rows = await InventoryLedger.find({ tenantId: ctx.tenantId, referenceId: 'RP-10' }).setOptions({ skipTenantFilter: true }).lean();
    assert.deepEqual(rows.map((row) => [row.movementType, row.qtyDelta]), [['return_restock', 1]]);
  });

  it('the RTO QC restock button goes through the one-time RTO restock', async () => {
    const ctx = await seller();
    const doc = await dispatched(ctx, 'R-11');
    await restockRtoOnce(ctx.tenantId, doc);
    await doc.save();
    await restockOrderReturn(ctx.tenantId, null, { orderNo: 'R-11', referenceId: 'RTO-R-11', movementType: 'rto_restock', items: [{ sku: 'MYN-SAREE', qty: 1 }] });
    assert.equal(await onHand(ctx), 10);
  });
});
