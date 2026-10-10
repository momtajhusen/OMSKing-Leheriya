process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const bcrypt = require('bcryptjs');
const Vendor = require('../src/models/Vendor');
const MasterSku = require('../src/models/MasterSku');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const vendors = require('../src/controllers/vendors.controller');
const orders = require('../src/controllers/orders.controller');

let memory;
let tenant;

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
  await Promise.all([Order.syncIndexes(), Vendor.syncIndexes()]);
  tenant = await Tenant.create({ name: 'Vendor shop', slug: `vend-${Date.now()}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: 'K1', name: 'Kurta' });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-1',
    channel: 'Shopify',
    source: 'manual',
    customer: 'Buyer',
    phone: '9000000000',
    status: 'New',
    items: [
      { name: 'Kurta', sku: 'K1', qty: 1, price: 1000, masterSkuId: sku._id },
      { name: 'Dupatta', sku: 'D1', qty: 1, price: 500, masterSkuId: sku._id },
    ],
    subOrders: [
      { id: 'SHP-1-1', index: 1, sku: 'K1', title: 'Kurta', price: 1000, masterSkuId: sku._id },
      { id: 'SHP-1-2', index: 2, sku: 'D1', title: 'Dupatta', price: 500, masterSkuId: sku._id },
    ],
  });
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('vendor CRUD rejects duplicates and soft-deletes', async () => {
  const a = await call(vendors.createVendor, { body: { name: ' Rajshree  Fabrics ', phone: '98', location: 'Jaipur' } });
  assert.equal(a.name, 'Rajshree Fabrics');
  await assert.rejects(() => call(vendors.createVendor, { body: { name: 'rajshree fabrics' } }), /already exists/);
  const imported = await call(vendors.importVendors, { body: { names: ['Meera', 'Rajshree Fabrics', 'null', 'Meera'] } });
  assert.equal(imported.added, 1);
  const removed = await call(vendors.removeVendor, { params: { id: a.id } });
  assert.equal(removed.removed, true);
  const list = await call(vendors.listVendors, {});
  assert.equal(list.length, 2);
  const back = await call(vendors.createVendor, { body: { name: 'Rajshree Fabrics' } });
  assert.equal(back.id, a.id);
  assert.equal(back.removed, false);
});

test('assigning needs a saved vendor and copies its contact', async () => {
  await assert.rejects(
    () => call(orders.assignSubOrder, { params: { orderId: 'SHP-1', subOrderId: 'SHP-1-1' }, body: { assignedVendor: 'Ghost Co' } }),
    /not a vendor/,
  );
  const dto = await call(orders.assignSubOrder, {
    params: { orderId: 'SHP-1', subOrderId: 'SHP-1-1' },
    body: { assignedVendor: 'rajshree fabrics' },
  });
  const sub = dto.subOrders.find((s) => s.id === 'SHP-1-1');
  assert.equal(sub.assignedVendor, 'Rajshree Fabrics');
  assert.equal(sub.vendorPhone, '98');
  assert.equal(sub.vendorStatus, 'Pending Acceptance');
  const list = await call(vendors.listVendors, {});
  assert.equal(list.find((v) => v.name === 'Rajshree Fabrics').assignedOrders, 1);
});

test('vendor users see only their lines and cannot use staff actions', async () => {
  const raj = await Vendor.findOne({ tenantId: tenant._id, nameNorm: 'rajshree fabrics' }).setOptions({ skipTenantFilter: true });
  const meera = await Vendor.findOne({ tenantId: tenant._id, nameNorm: 'meera' }).setOptions({ skipTenantFilter: true });

  const mine = await call(orders.listOrders, vendorReq(raj._id));
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].subOrders.map((s) => s.id), ['SHP-1-1']);
  assert.deepEqual(mine[0].items.map((i) => i.sku), ['K1']);
  assert.equal(mine[0].phone, '');

  assert.equal((await call(orders.listOrders, vendorReq(meera._id))).length, 0);
  await assert.rejects(
    () => call(orders.patchStatus, vendorReq(raj._id, { params: { orderId: 'SHP-1' }, body: { status: 'Delivered' } })),
    /Vendors cannot/,
  );
  await assert.rejects(
    () => call(orders.vendorUpdate, vendorReq(meera._id, { params: { orderId: 'SHP-1', subOrderId: 'SHP-1-1' }, body: { action: 'accept' } })),
    /not found/,
  );
});

test('vendor flow: accept, dispatch needs tracking, deliver', async () => {
  const raj = await Vendor.findOne({ tenantId: tenant._id, nameNorm: 'rajshree fabrics' }).setOptions({ skipTenantFilter: true });
  const params = { orderId: 'SHP-1', subOrderId: 'SHP-1-1' };
  await assert.rejects(() => call(orders.vendorUpdate, vendorReq(raj._id, { params, body: { action: 'deliver' } })), /Cannot deliver/);
  await call(orders.vendorUpdate, vendorReq(raj._id, { params, body: { action: 'accept' } }));
  await assert.rejects(() => call(orders.vendorUpdate, vendorReq(raj._id, { params, body: { action: 'dispatch' } })), /Tracking number/);
  const sent = await call(orders.vendorUpdate, vendorReq(raj._id, {
    params,
    body: { action: 'dispatch', trackingNumber: 'AWB123', courier: 'Delhivery' },
  }));
  const line = sent.subOrders[0];
  assert.equal(line.vendorStatus, 'Dispatched');
  assert.equal(line.trackingNumber, 'AWB123');
  assert.ok(line.dispatchDate);
  const done = await call(orders.vendorUpdate, vendorReq(raj._id, { params, body: { action: 'deliver' } }));
  assert.equal(done.subOrders[0].vendorStatus, 'Delivered');
});

test('vendor login can update its own profile and cannot update another', async () => {
  const raj = await Vendor.findOne({ tenantId: tenant._id, nameNorm: 'rajshree fabrics' }).setOptions({ skipTenantFilter: true });
  const meera = await Vendor.findOne({ tenantId: tenant._id, nameNorm: 'meera' }).setOptions({ skipTenantFilter: true });
  const mine = await call(vendors.updateMe, vendorReq(raj._id, { body: { phone: '999', telegramGroup: 'https://t.me/raj' } }));
  assert.equal(mine.phone, '999');
  assert.equal(mine.telegramGroup, 'https://t.me/raj');
  await assert.rejects(
    () => call(vendors.updateVendor, vendorReq(raj._id, { params: { id: String(meera._id) }, body: { phone: '000' } })),
    /not found/,
  );
});

test('super admin can set a vendor login password', async () => {
  const role = await Role.create({ tenantId: tenant._id, code: 'vendor', name: 'Vendor', permissions: [] });
  const row = await call(vendors.createVendor, { body: { name: 'Password Looms', email: 'looms@example.com', phone: '91' } });
  await assert.rejects(
    () => call(vendors.setVendorPassword, {
      user: { id: null, role: 'operations' },
      params: { id: row.id },
      body: { password: 'VendorPass1' },
    }),
    /Super Admin/,
  );
  await assert.rejects(
    () => call(vendors.setVendorPassword, { params: { id: row.id }, body: { password: 'short' } }),
    /at least 8/,
  );
  const created = await call(vendors.setVendorPassword, { params: { id: row.id }, body: { password: 'VendorPass1' } });
  assert.equal(created.email, 'looms@example.com');
  assert.equal(created.created, true);
  const user = await User.findOne({ tenantId: tenant._id, email: 'looms@example.com' }).setOptions({ skipTenantFilter: true });
  assert.equal(String(user.roleId), String(role._id));
  assert.equal(String(user.assignedVendorIds[0]), row.id);
  assert.equal(await bcrypt.compare('VendorPass1', user.passwordHash), true);

  const updated = await call(vendors.setVendorPassword, { params: { id: row.id }, body: { password: 'VendorPass2' } });
  assert.equal(updated.created, false);
  const again = await User.findById(user._id).setOptions({ skipTenantFilter: true });
  assert.equal(await bcrypt.compare('VendorPass2', again.passwordHash), true);
  assert.equal(again.refreshTokenVersion, 1);
});
