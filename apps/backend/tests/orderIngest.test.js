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
const InventoryLedger = require('../src/models/InventoryLedger');
const InventoryReservation = require('../src/models/InventoryReservation');
const shopify = require('../src/adapters/shopify');
const { als } = require('../src/lib/tenantContext');
const { stockIn } = require('../src/services/inventory.service');
const { ingestChannelOrders } = require('../src/services/channelOrder.service');
const { listOrders } = require('../src/controllers/orders.controller');

let replSet;

function shopifyOrder(id, { cancelled = false, fulfillment = null, total = '100.00' } = {}) {
  return shopify.mapShopifyOrder({
    id,
    created_at: '2026-08-01T10:00:00Z',
    cancelled_at: cancelled ? '2026-08-02T10:00:00Z' : null,
    financial_status: 'paid',
    fulfillment_status: fulfillment,
    payment_gateway_names: ['UPI'],
    total_price: total,
    shipping_address: { name: 'Asha Mehta', address1: '12 MG Road', city: 'Surat', province: 'GJ', zip: '395003', phone: '9811100001' },
    line_items: [{
      id: 1, sku: 'KURTA', title: 'Kurta', quantity: 1, price: total,
    }],
  }, {});
}

async function seller() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await Tenant.create({ name: 'Ingest', slug: `ingest-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `KURTA-${stamp}`, name: 'Kurta' });
  const physical = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Physical',
    type: 'physical',
    isDefault: true,
    isPickup: true,
    sellOnShopify: true,
    status: 'active',
  });
  const virtual = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-002',
    name: 'Virtual',
    type: 'virtual',
    sellOnShopify: true,
    isPickup: false,
    status: 'active',
  });
  await WarehouseLocationMap.create({
    tenantId: tenant._id,
    warehouseId: virtual._id,
    channel: 'shopify',
    externalLocationId: '222',
  });
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
    qty: 5,
    reason: 'opening',
  });
  return { tenant, sku, physical };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function ordersFor(tenant, query) {
  const res = fakeRes();
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false }, () => listOrders({
    tenantId: tenant._id,
    skipTenantFilter: false,
    query,
  }, res));
  return res.body?.data || [];
}

async function holds(tenantId, orderNo) {
  return InventoryReservation.countDocuments({ tenantId, orderRef: orderNo, status: 'held' });
}

async function reserveRows(tenantId, orderNo) {
  return InventoryLedger.countDocuments({ tenantId, referenceId: orderNo, movementType: 'order_reserve' });
}

describe('order ingestion', () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Order.syncIndexes();
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  it('indexes company + channel + channel order id', async () => {
    const indexes = await Order.collection.indexes();
    const hit = indexes.find((row) => (
      row.key?.tenantId === 1 && row.key?.channel === 1 && row.key?.externalOrderId === 1
    ));
    assert.ok(hit, 'missing unique index on tenantId + channel + externalOrderId');
    assert.equal(hit.unique, true);
    assert.ok(hit.partialFilterExpression, 'blank channel order ids must stay out of the unique index');
    const tenant = await Tenant.create({ name: 'Blank', slug: `blank-${Date.now()}`, kind: 'merchant' });
    await Order.create({ tenantId: tenant._id, orderNo: 'MAN-1', channel: 'Shopify', status: 'New', total: 1, source: 'manual', externalOrderId: '' });
    await Order.create({ tenantId: tenant._id, orderNo: 'MAN-2', channel: 'Shopify', status: 'New', total: 1, source: 'manual', externalOrderId: '' });
    assert.equal(await Order.countDocuments({ tenantId: tenant._id, externalOrderId: '' }), 2);
  });

  it('delivers the same channel order twice as one Master Order and one stock lock', async () => {
    const { tenant } = await seller();
    const id = String(tenant._id);
    const first = await ingestChannelOrders(id, 'shopify', [shopifyOrder(4401)]);
    const second = await ingestChannelOrders(id, 'shopify', [shopifyOrder(4401)]);
    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(await Order.countDocuments({ tenantId: tenant._id, channel: 'Shopify', externalOrderId: '4401' }), 1);
    assert.equal(await holds(tenant._id, 'SHP-4401'), 1);
    assert.equal(await reserveRows(tenant._id, 'SHP-4401'), 1);
  });

  it('keeps one Master Order and one stock lock when the same order arrives concurrently', async () => {
    const { tenant } = await seller();
    const id = String(tenant._id);
    const payload = [shopifyOrder(4402)];
    const results = await Promise.all([
      ingestChannelOrders(id, 'shopify', payload),
      ingestChannelOrders(id, 'shopify', payload),
    ]);
    const created = results.reduce((sum, row) => sum + row.created, 0);
    assert.equal(created, 1);
    assert.equal(await Order.countDocuments({ tenantId: tenant._id, externalOrderId: '4402' }), 1);
    assert.equal(await holds(tenant._id, 'SHP-4402'), 1);
    assert.equal(await reserveRows(tenant._id, 'SHP-4402'), 1);
  });

  it('lists cancelled orders on All Orders and returns an unfulfilled order to New', async () => {
    const { tenant } = await seller();
    const id = String(tenant._id);
    await ingestChannelOrders(id, 'shopify', [shopifyOrder(4403, { cancelled: true, total: '500.00' })]);
    await ingestChannelOrders(id, 'shopify', [shopifyOrder(4404, { total: '100.00' })]);
    const all = await ordersFor(tenant, { status: 'all' });
    const numbers = all.map((row) => row.id);
    assert.ok(numbers.includes('SHP-4403'));
    assert.ok(numbers.includes('SHP-4404'));
    const net = all.filter((row) => row.status !== 'Cancelled').reduce((sum, row) => sum + Number(row.total || 0), 0);
    assert.equal(net, 100);
    const cancelledTab = await ordersFor(tenant, { status: 'Cancelled' });
    assert.ok(cancelledTab.some((row) => row.id === 'SHP-4403'));

    await ingestChannelOrders(id, 'shopify', [shopifyOrder(4403, { cancelled: false, fulfillment: null, total: '500.00' })]);
    const reopened = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-4403' }).setOptions({ skipTenantFilter: true });
    assert.equal(reopened.status, 'New');
    const fresh = await ordersFor(tenant, { status: 'New' });
    assert.ok(fresh.some((row) => row.id === 'SHP-4403'));
  });
});
