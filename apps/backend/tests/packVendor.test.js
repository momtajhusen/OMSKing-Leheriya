process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Vendor = require('../src/models/Vendor');
const Warehouse = require('../src/models/Warehouse');
const MasterSku = require('../src/models/MasterSku');
const Inventory = require('../src/models/Inventory');
const orders = require('../src/controllers/orders.controller');

let memory;
let tenant;
let sku;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(handler, req) {
  const res = fakeRes();
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false, userId: null }, () => handler({
    tenantId: String(tenant._id),
    user: { id: null, role: 'super_admin' },
    params: {},
    query: {},
    body: {},
    ...req,
  }, res));
  return res.body?.data;
}

function vendorReq(vendorId, extra = {}) {
  return {
    user: { id: null, role: 'vendor', assignedVendorIds: [vendorId] },
    vendorScope: { active: true, assignedVendorIds: [String(vendorId)] },
    ...extra,
  };
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  tenant = await Tenant.create({ name: 'Pack shop', slug: `pack-${Date.now()}`, kind: 'merchant' });
  sku = await MasterSku.create({ tenantId: tenant._id, code: 'KURTA', name: 'Kurta' });
  const physical = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Physical',
    type: 'physical',
    isDefault: true,
    status: 'active',
    sellOnShopify: true,
    sellOnAmazon: true,
    sellOnMyntra: true,
  });
  await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-002',
    name: 'Virtual',
    type: 'virtual',
    status: 'active',
    sellOnShopify: true,
    sellOnAmazon: false,
    sellOnMyntra: false,
  });
  await Inventory.create({
    tenantId: tenant._id,
    masterSkuId: sku._id,
    warehouseId: physical._id,
    physicalQty: 2,
    virtualQty: 0,
    reservedQty: 0,
  });
  await Vendor.create({ tenantId: tenant._id, name: 'Vendor A', nameNorm: 'vendor a', phone: '9811100001' });
  await Vendor.create({ tenantId: tenant._id, name: 'Vendor B', nameNorm: 'vendor b', phone: '9811100002' });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-PACK',
    channel: 'Shopify',
    source: 'manual',
    customer: 'Asha',
    phone: '9811199999',
    status: 'New',
    total: 2000,
    items: [{ name: 'Kurta', sku: 'KURTA', qty: 1, price: 1000, masterSkuId: sku._id }],
    subOrders: [{ id: 'SHP-PACK-1', index: 1, sku: 'KURTA', title: 'Kurta', qty: 1, price: 1000 }],
  });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-SPLIT',
    channel: 'Shopify',
    source: 'manual',
    customer: 'Asha',
    phone: '9811199999',
    status: 'New',
    total: 2000,
    items: [{ name: 'Kurta', sku: 'KURTA', qty: 2, price: 1000, masterSkuId: sku._id }],
    subOrders: [
      { id: 'SHP-SPLIT-1', index: 1, sku: 'KURTA', title: 'Kurta', qty: 1, price: 1000 },
      { id: 'SHP-SPLIT-2', index: 2, sku: 'KURTA', title: 'Kurta', qty: 1, price: 1000 },
    ],
  });
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('offline stock is a WH-001 pack line', async () => {
  const rows = await call(orders.listOrders, { query: { status: 'all' } });
  const pack = rows.find((row) => row.id === 'SHP-PACK');
  assert.equal(pack.fulfilmentSource, 'Offline');
  assert.equal(pack.routeNote, 'WH-001 pack');
  assert.equal(pack.subOrders[0].fulfilmentSource, 'Offline');
});

test('short stock splits one order into a pack line and a vendor line', async () => {
  const rows = await call(orders.listOrders, { query: { status: 'all' } });
  const split = rows.filter((row) => row.id === 'SHP-SPLIT' || row.orderNo === 'SHP-SPLIT');
  assert.equal(split.length, 1);
  assert.equal(await Order.countDocuments({ tenantId: tenant._id, orderNo: 'SHP-SPLIT' }), 1);
  const row = split[0];
  assert.equal(row.fulfilmentSource, 'Mixed');
  assert.match(row.routeNote, /WH-001/);
  assert.equal(row.subOrders.filter((sub) => sub.fulfilmentSource === 'Offline').length, 1);
  assert.equal(row.subOrders.filter((sub) => sub.fulfilmentSource === 'Virtual').length, 1);
});

test('vendor A cannot see vendor B lines', async () => {
  const vendorA = await Vendor.findOne({ tenantId: tenant._id, nameNorm: 'vendor a' }).setOptions({ skipTenantFilter: true });
  const vendorB = await Vendor.findOne({ tenantId: tenant._id, nameNorm: 'vendor b' }).setOptions({ skipTenantFilter: true });
  await call(orders.assignSubOrder, { params: { orderId: 'SHP-SPLIT', subOrderId: 'SHP-SPLIT-2' }, body: { assignedVendor: 'Vendor B' } });
  await call(orders.assignSubOrder, { params: { orderId: 'SHP-SPLIT', subOrderId: 'SHP-SPLIT-1' }, body: { assignedVendor: 'Vendor A' } });

  const mine = await call(orders.listOrders, vendorReq(vendorA._id, { query: { status: 'all' } }));
  const order = mine.find((row) => row.id === 'SHP-SPLIT');
  assert.ok(order);
  assert.deepEqual(order.subOrders.map((sub) => sub.id), ['SHP-SPLIT-1']);
  assert.equal(JSON.stringify(order).includes('Vendor B'), false);
  assert.equal(JSON.stringify(order).includes('9811100002'), false);

  const detail = await call(orders.getOrder, vendorReq(vendorA._id, { params: { orderId: 'SHP-SPLIT' } }));
  assert.equal(JSON.stringify(detail).includes('Vendor B'), false);
  assert.equal(JSON.stringify(detail).includes('SHP-SPLIT-2'), false);

  await assert.rejects(
    () => call(orders.vendorUpdate, vendorReq(vendorA._id, {
      params: { orderId: 'SHP-SPLIT', subOrderId: 'SHP-SPLIT-2' },
      body: { action: 'accept' },
    })),
    /not found/,
  );

  const theirs = await call(orders.listOrders, vendorReq(vendorB._id, { query: { status: 'all' } }));
  const hidden = theirs.find((row) => row.id === 'SHP-SPLIT');
  assert.deepEqual(hidden.subOrders.map((sub) => sub.id), ['SHP-SPLIT-2']);
  assert.equal(JSON.stringify(hidden).includes('Vendor A'), false);
});

test('one tracking number can be saved on two lines', async () => {
  const vendorA = await Vendor.findOne({ tenantId: tenant._id, nameNorm: 'vendor a' }).setOptions({ skipTenantFilter: true });
  for (const id of ['SHP-SPLIT-1', 'SHP-PACK-1']) {
    if (id === 'SHP-PACK-1') {
      await call(orders.assignSubOrder, { params: { orderId: 'SHP-PACK', subOrderId: id }, body: { assignedVendor: 'Vendor A' } });
    }
    await call(orders.vendorUpdate, vendorReq(vendorA._id, {
      params: { orderId: id.startsWith('SHP-PACK') ? 'SHP-PACK' : 'SHP-SPLIT', subOrderId: id },
      body: { action: 'accept' },
    }));
    await call(orders.vendorUpdate, vendorReq(vendorA._id, {
      params: { orderId: id.startsWith('SHP-PACK') ? 'SHP-PACK' : 'SHP-SPLIT', subOrderId: id },
      body: { action: 'dispatch', trackingNumber: 'AWB-SHARED', courier: 'Delhivery' },
    }));
  }
  const saved = await Order.find({ tenantId: tenant._id, 'subOrders.trackingNumber': 'AWB-SHARED' }).setOptions({ skipTenantFilter: true });
  const lines = saved.flatMap((row) => row.subOrders).filter((sub) => sub.trackingNumber === 'AWB-SHARED');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((sub) => sub.id).sort(), ['SHP-PACK-1', 'SHP-SPLIT-1']);
});

test('vendor reject needs a reason and the line can be assigned again', async () => {
  const vendorB = await Vendor.findOne({ tenantId: tenant._id, nameNorm: 'vendor b' }).setOptions({ skipTenantFilter: true });
  await assert.rejects(
    () => call(orders.vendorUpdate, vendorReq(vendorB._id, {
      params: { orderId: 'SHP-SPLIT', subOrderId: 'SHP-SPLIT-2' },
      body: { action: 'reject', reason: '   ' },
    })),
    /reason/,
  );
  const rejected = await call(orders.vendorUpdate, vendorReq(vendorB._id, {
    params: { orderId: 'SHP-SPLIT', subOrderId: 'SHP-SPLIT-2' },
    body: { action: 'reject', reason: 'Fabric is out' },
  }));
  const line = rejected.subOrders.find((sub) => sub.id === 'SHP-SPLIT-2');
  assert.equal(line, undefined);
  const stored = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-SPLIT' }).setOptions({ skipTenantFilter: true });
  const held = stored.subOrders.find((sub) => sub.id === 'SHP-SPLIT-2');
  assert.equal(held.assignedVendor, '');
  assert.equal(held.rejectReason, 'Fabric is out');

  const again = await call(orders.assignSubOrder, {
    params: { orderId: 'SHP-SPLIT', subOrderId: 'SHP-SPLIT-2' },
    body: { assignedVendor: 'Vendor A' },
  });
  const moved = again.subOrders.find((sub) => sub.id === 'SHP-SPLIT-2');
  assert.equal(moved.assignedVendor, 'Vendor A');
  assert.equal(moved.vendorStatus, 'Pending Acceptance');
});
