process.env.NODE_ENV = 'test';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const Order = require('../src/models/Order');
const orders = require('../src/controllers/orders.controller');

let memory;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(tenant, handler, req = {}) {
  const res = fakeRes();
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false }, () => handler({
    tenantId: String(tenant._id),
    user: { id: null, role: 'super_admin' },
    params: {},
    query: {},
    body: {},
    ...req,
  }, res));
  return res.body;
}

function unmappedOrder(tenant, orderNo, sku) {
  return Order.create({
    tenantId: tenant._id,
    orderNo,
    channel: 'Myntra',
    source: 'manual',
    customer: 'Rubi',
    status: 'New',
    paymentMode: 'COD',
    total: 2218,
    items: [{ name: 'Kurta', sku, qty: 1, price: 2218 }],
    subOrders: [{ id: `${orderNo}-1`, index: 1, sku, title: 'Kurta', qty: 1, price: 2218 }],
  });
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await Promise.all([MasterSku.syncIndexes(), SkuMapping.syncIndexes(), Order.syncIndexes()]);
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('an unmapped line is mapped to a Master SKU from inside the order', async () => {
  const tenant = await Tenant.create({ name: 'Map in order', slug: `mio-${Date.now()}`, kind: 'merchant' });
  const master = await MasterSku.create({ tenantId: tenant._id, code: 'LEH-KDG205', name: 'Kurta' });
  await unmappedOrder(tenant, 'MYN-100464330372', 'MLEH-KDG205');

  const before = await call(tenant, orders.getOrder, { params: { orderId: 'MYN-100464330372' } });
  assert.equal(before.data.mappingFailed, true);

  const out = await call(tenant, orders.mapItemSku, {
    params: { orderId: 'MYN-100464330372' },
    body: { sku: 'MLEH-KDG205', masterSkuCode: 'leh-kdg205' },
  });
  assert.equal(out.data.mappingFailed, false);
  assert.notEqual(out.data.status, 'Unfulfillable');
  assert.equal(out.data.items[0].mappingFailed, false);

  const saved = await Order.findOne({ tenantId: tenant._id, orderNo: 'MYN-100464330372' });
  assert.equal(String(saved.items[0].masterSkuId), String(master._id));
  assert.equal(String(saved.subOrders[0].masterSkuId), String(master._id));
  const listing = await SkuMapping.findOne({ tenantId: tenant._id, channel: 'myntra', channelSkuCode: 'MLEH-KDG205' });
  assert.equal(String(listing.masterSkuId), String(master._id));
  assert.equal(listing.syncStatus, 'synced');
});

test('an existing unmapped listing for that SKU is reused, not duplicated', async () => {
  const tenant = await Tenant.create({ name: 'Reuse listing', slug: `reuse-${Date.now()}`, kind: 'merchant' });
  const master = await MasterSku.create({ tenantId: tenant._id, code: 'LEH-BB48', name: 'Saree' });
  await SkuMapping.create({
    tenantId: tenant._id,
    channel: 'myntra',
    channelVariantId: 'myn-style-777',
    channelSkuCode: 'MLEHBB48',
    channelSkuCodeNorm: 'MLEHBB48',
    syncStatus: 'unmapped',
  });
  await unmappedOrder(tenant, 'MYN-100464952344', 'MLEHBB48');

  await call(tenant, orders.mapItemSku, {
    params: { orderId: 'MYN-100464952344' },
    body: { sku: 'MLEHBB48', masterSkuCode: 'LEH-BB48' },
  });
  const rows = await SkuMapping.find({ tenantId: tenant._id, channel: 'myntra' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channelVariantId, 'myn-style-777');
  assert.equal(String(rows[0].masterSkuId), String(master._id));
});

test('a wrong Master SKU or a SKU that is not on the order is refused and nothing changes', async () => {
  const tenant = await Tenant.create({ name: 'Map refuse', slug: `refuse-${Date.now()}`, kind: 'merchant' });
  await MasterSku.create({ tenantId: tenant._id, code: 'LEH-REAL', name: 'Real' });
  await unmappedOrder(tenant, 'MYN-REF-1', 'MLEH-REF');

  await assert.rejects(
    () => call(tenant, orders.mapItemSku, { params: { orderId: 'MYN-REF-1' }, body: { sku: 'MLEH-REF', masterSkuCode: 'NOPE' } }),
    /Master SKU not found/,
  );
  await assert.rejects(
    () => call(tenant, orders.mapItemSku, { params: { orderId: 'MYN-REF-1' }, body: { sku: 'OTHER', masterSkuCode: 'LEH-REAL' } }),
    /not on this order/,
  );
  await assert.rejects(
    () => call(tenant, orders.mapItemSku, { params: { orderId: 'MYN-REF-1' }, body: { sku: 'MLEH-REF', masterSkuCode: '' } }),
    /Master SKU code is required/,
  );
  const saved = await Order.findOne({ tenantId: tenant._id, orderNo: 'MYN-REF-1' });
  assert.equal(saved.items[0].masterSkuId, null);
});

test('another company cannot map a line on this order, and vendors cannot map at all', async () => {
  const owner = await Tenant.create({ name: 'Owner', slug: `own-${Date.now()}`, kind: 'merchant' });
  const other = await Tenant.create({ name: 'Other', slug: `oth-${Date.now()}`, kind: 'merchant' });
  await MasterSku.create({ tenantId: other._id, code: 'LEH-X', name: 'X' });
  await unmappedOrder(owner, 'MYN-ISO-1', 'MLEH-X');

  await assert.rejects(
    () => call(other, orders.mapItemSku, { params: { orderId: 'MYN-ISO-1' }, body: { sku: 'MLEH-X', masterSkuCode: 'LEH-X' } }),
    /Order not found/,
  );
  await assert.rejects(
    () => call(owner, orders.mapItemSku, {
      params: { orderId: 'MYN-ISO-1' },
      body: { sku: 'MLEH-X', masterSkuCode: 'LEH-X' },
      vendorScope: { active: true, assignedVendorIds: [] },
    }),
    /Vendors cannot change this/,
  );
});

test('the order map-SKU route needs order edit and catalog edit permission', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/v1/orders.routes.js'), 'utf8');
  assert.match(routes, /router\.post\('\/:orderId\/map-sku', \.\.\.edit, requirePermission\('catalog\.edit'\), asyncHandler\(orders\.mapItemSku\)\)/);
});
