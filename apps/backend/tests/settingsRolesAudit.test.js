process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { hashPassword } = require('../src/lib/password');
const { ensureDefaultWarehouses, setInventoryAuthority } = require('../src/services/warehouse.service');
const { stockIn } = require('../src/services/inventory.service');
const { queueInventoryPushes, runInventoryJob } = require('../src/services/inventoryPush.service');
const shopify = require('../src/adapters/shopify');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Vendor = require('../src/models/Vendor');
const Order = require('../src/models/Order');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const Warehouse = require('../src/models/Warehouse');
const Inventory = require('../src/models/Inventory');
const AuditLog = require('../src/models/AuditLog');
const IntegrationJob = require('../src/models/IntegrationJob');

const PASSWORD = 'Password1';
const OLD_GSTIN = '08OLDGSTIN0001Z';
const NEW_GSTIN = '08NEWGSTIN0001Z';
const SECRET = 'App-Pass-99';

let memory;
let server;
let base;

function passwordKeys(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  const hits = [];
  for (const [key, child] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    if (/password|secret|token/i.test(key)) hits.push(here);
    hits.push(...passwordKeys(child, here));
  }
  return hits;
}

function cookieHeader(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const raw = list.length ? list : [res.headers.get('set-cookie')].filter(Boolean);
  return raw.map((row) => String(row).split(';')[0]).join('; ');
}

async function api(method, path, { token, json } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  return { status: res.status, body, cookie: cookieHeader(res) };
}

async function login(email, password = PASSWORD) {
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken;
}

async function staff(tenantId, roles, code, email, extra = {}) {
  const role = roles.find((row) => row.code === code);
  return User.create({
    tenantId,
    fullName: code,
    email,
    passwordHash: await hashPassword(PASSWORD),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
    ...extra,
  });
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await AuditLog.syncIndexes();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('company GSTIN save audits before and after and keeps passwords out of the payload', async () => {
  const created = await provisionMerchant({
    name: 'GST Audit',
    ownerEmail: `gst-${Date.now()}@example.com`,
    ownerName: 'Owner',
    password: PASSWORD,
    status: 'active',
  });
  created.tenant.legalEntity = { ...(created.tenant.legalEntity || {}), gstin: OLD_GSTIN };
  created.tenant.markModified('legalEntity');
  await created.tenant.save();
  const token = await login(created.owner.email);
  const saved = await api('PATCH', '/api/v1/settings/company', {
    token,
    json: {
      gstin: NEW_GSTIN,
      gmailUser: 'shop@example.com',
      gmailAppPassword: SECRET,
      password: 'Should-Not-Stick-1',
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.gstin, NEW_GSTIN);
  assert.equal(passwordKeys(saved.body).length, 0);
  assert.equal(JSON.stringify(saved.body).includes(SECRET), false);
  assert.equal(JSON.stringify(saved.body).includes('Should-Not-Stick-1'), false);

  const log = await AuditLog.findOne({ tenantId: created.tenant._id, action: 'company.updated' }).setOptions({ skipTenantFilter: true });
  const gstin = log.changes.find((change) => change.field === 'gstin');
  assert.equal(gstin.before, OLD_GSTIN);
  assert.equal(gstin.after, NEW_GSTIN);
  const stored = log.toObject();
  assert.equal(passwordKeys(stored).length, 0);
  assert.equal(JSON.stringify(stored).includes(SECRET), false);
  assert.equal(JSON.stringify(stored).includes('Should-Not-Stick-1'), false);
});

test('OMS master qty is editable, and Shopify master leaves WH-001 read-only with no Shopify push', async () => {
  const created = await provisionMerchant({
    name: 'Stock Authority',
    ownerEmail: `stock-${Date.now()}@example.com`,
    ownerName: 'Owner',
    password: PASSWORD,
    status: 'active',
  });
  const tenantId = created.tenant._id;
  await ensureDefaultWarehouses(tenantId);
  const sku = await MasterSku.create({ tenantId, code: 'AUTH-1', name: 'Dupatta' });
  const wh = await Warehouse.findOne({ tenantId, code: 'WH-001' }).setOptions({ skipTenantFilter: true });
  await SkuMapping.create({
    tenantId,
    masterSkuId: sku._id,
    channel: 'shopify',
    channelVariantId: 'var-auth',
    channelSkuCode: 'AUTH-1',
    channelSkuCodeNorm: 'auth-1',
    syncStatus: 'synced',
    isActive: true,
  });
  await setInventoryAuthority(tenantId, 'oms');
  const edited = await stockIn(tenantId, null, { masterSkuId: sku._id, warehouseId: wh._id, qty: 4, reason: 'receipt' });
  assert.equal(edited.warehouse, 'WH-001');
  assert.equal(edited.available, 4);
  const queuedWhileOms = await IntegrationJob.find({ tenantId, channel: 'shopify', jobType: 'inventory_push' }).setOptions({ skipTenantFilter: true });
  assert.equal(queuedWhileOms.length, 1);

  await setInventoryAuthority(tenantId, 'shopify');
  await assert.rejects(
    () => stockIn(tenantId, null, { masterSkuId: sku._id, warehouseId: wh._id, qty: 9, reason: 'blocked' }),
    (err) => err.statusCode === 403 && /Shopify is inventory master/.test(err.message),
  );
  const balance = await Inventory.findOne({ tenantId, masterSkuId: sku._id, warehouseId: wh._id }).setOptions({ skipTenantFilter: true });
  assert.equal(balance.physicalQty, 4);

  let pushed = 0;
  const original = shopify.pushInventory;
  shopify.pushInventory = async () => {
    pushed += 1;
    return { sent: [] };
  };
  try {
    const jobs = await queueInventoryPushes(tenantId, null, sku._id);
    assert.equal(jobs.filter((job) => job.channel === 'shopify').length, 0);
    await assert.rejects(() => runInventoryJob(queuedWhileOms[0]));
    assert.equal(pushed, 0);
  } finally {
    shopify.pushInventory = original;
  }
  const shopifyJobs = await IntegrationJob.countDocuments({ tenantId, channel: 'shopify', jobType: 'inventory_push' }).setOptions({ skipTenantFilter: true });
  assert.equal(shopifyJobs, 1);
});

test('operations can pack and ship, and is refused settings, subscription, users, payments and reports', async () => {
  const created = await provisionMerchant({
    name: 'Ops Shop',
    ownerEmail: `owner-ops-${Date.now()}@example.com`,
    ownerName: 'Owner',
    password: PASSWORD,
    status: 'active',
  });
  const email = `ops-${Date.now()}@leheriya.com`;
  await staff(created.tenant._id, created.roles, 'operations', email);
  const sku = await MasterSku.create({ tenantId: created.tenant._id, code: 'OPS-1', name: 'Kurta' });
  await Order.create({
    tenantId: created.tenant._id,
    orderNo: 'OPS-1',
    channel: 'Shopify',
    source: 'manual',
    status: 'New',
    total: 80,
    items: [{ name: 'Kurta', sku: 'OPS-1', qty: 1, price: 80, masterSkuId: sku._id }],
    subOrders: [{ id: 'OPS-1-1', index: 1, sku: 'OPS-1', title: 'Kurta', qty: 1, price: 80, masterSkuId: sku._id, status: 'New' }],
  });
  const token = await login(email);
  const orders = await api('GET', '/api/v1/orders', { token });
  assert.equal(orders.status, 200);
  assert.equal(orders.body.data.some((row) => row.id === 'OPS-1'), true);
  const packed = await api('PATCH', '/api/v1/orders/OPS-1/status', { token, json: { status: 'Packed' } });
  assert.equal(packed.status, 200, JSON.stringify(packed.body));
  assert.equal(packed.body.data.status, 'Packed');
  const readiness = await api('GET', '/api/v1/orders/shipping-readiness', { token });
  assert.equal(readiness.status, 200);
  const shipGate = await api('POST', '/api/v1/orders/MISSING-SHIP/ship', { token, json: {} });
  assert.equal(shipGate.status, 404);

  const denied = await Promise.all([
    api('GET', '/api/v1/settings/company', { token }),
    api('GET', '/api/v1/pricing/mine', { token }),
    api('GET', '/api/v1/pricing/mine/upi', { token }),
    api('GET', '/api/v1/users', { token }),
    api('GET', '/api/v1/roles', { token }),
    api('POST', '/api/v1/finance/settlements', { token, json: { source: 'amazon', csv: 'order,amount\nX,1' } }),
    api('POST', '/api/v1/orders/OPS-1/payment', { token, json: {} }),
    api('GET', '/api/v1/reports', { token }),
  ]);
  for (const res of denied) {
    assert.equal(res.status, 403, JSON.stringify(res.body));
  }
  const owner = await login(created.owner.email);
  const report = await api('GET', '/api/v1/reports', { token: owner });
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.equal(report.body.data.orders, 1);
  assert.equal(report.body.data.netSalesPaise, 8000);
});

test('a vendor cannot open users or finance reconcile, and cannot edit another vendor', async () => {
  const created = await provisionMerchant({
    name: 'Vendor Gate',
    ownerEmail: `owner-v-${Date.now()}@example.com`,
    ownerName: 'Owner',
    password: PASSWORD,
    status: 'active',
  });
  const raj = await Vendor.create({ tenantId: created.tenant._id, name: 'Raj Prints', nameNorm: 'raj prints', phone: '9111111111' });
  const meera = await Vendor.create({ tenantId: created.tenant._id, name: 'Meera Looms', nameNorm: 'meera looms', phone: '9222222222', email: 'meera@example.com' });
  const email = `vendor-${Date.now()}@example.com`;
  await staff(created.tenant._id, created.roles, 'vendor', email, { assignedVendorIds: [raj._id] });
  const token = await login(email);
  const users = await api('GET', '/api/v1/users', { token });
  const roles = await api('GET', '/api/v1/roles', { token });
  const finance = await api('POST', '/api/v1/finance/settlements', { token, json: { source: 'amazon', csv: 'order,amount\nX,1' } });
  const pay = await api('POST', '/api/v1/orders/NONE/payment', { token, json: {} });
  assert.equal(users.status, 403);
  assert.equal(roles.status, 403);
  assert.equal(finance.status, 403);
  assert.equal(pay.status, 403);

  const own = await api('PATCH', '/api/v1/vendors/me', { token, json: { phone: '9333333333' } });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(own.body.data.phone, '9333333333');
  const other = await api('PATCH', `/api/v1/vendors/${meera._id}`, { token, json: { phone: '9000000000' } });
  assert.equal(other.status === 403 || other.status === 404, true);
  const fresh = await Vendor.findById(meera._id).setOptions({ skipTenantFilter: true });
  assert.equal(fresh.phone, '9222222222');
});

test('super admin can set a vendor login password, and the password is not returned', async () => {
  const created = await provisionMerchant({
    name: 'Vendor Login',
    ownerEmail: `owner-p-${Date.now()}@example.com`,
    ownerName: 'Owner',
    password: PASSWORD,
    status: 'active',
  });
  const email = `loom-${Date.now()}@example.com`;
  const vendor = await Vendor.create({
    tenantId: created.tenant._id,
    name: 'Password Looms',
    nameNorm: 'password looms',
    email,
    phone: '9444444444',
  });
  const opsEmail = `ops-pass-${Date.now()}@example.com`;
  await staff(created.tenant._id, created.roles, 'operations', opsEmail);
  const ops = await login(opsEmail);
  const refused = await api('POST', `/api/v1/vendors/${vendor._id}/password`, { token: ops, json: { password: 'VendorPass1' } });
  assert.equal(refused.status, 403);
  const owner = await login(created.owner.email);
  const set = await api('POST', `/api/v1/vendors/${vendor._id}/password`, { token: owner, json: { password: 'VendorPass1' } });
  assert.equal(set.status, 201, JSON.stringify(set.body));
  assert.equal(set.body.data.email, email);
  assert.equal(JSON.stringify(set.body).includes('VendorPass1'), false);
  const vendorToken = await login(email, 'VendorPass1');
  assert.ok(vendorToken);
});

test('audit rows are append-only and the newest change is first', async () => {
  const created = await provisionMerchant({
    name: 'Audit Order',
    ownerEmail: `audit-${Date.now()}@example.com`,
    ownerName: 'Owner',
    password: PASSWORD,
    status: 'active',
  });
  const tenantId = created.tenant._id;
  const older = await AuditLog.create({
    tenantId,
    action: 'company.updated',
    resourceType: 'company',
    resourceDisplay: 'older',
    changes: [{ field: 'gstin', before: OLD_GSTIN, after: '08MIDGSTIN0001Z' }],
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  await AuditLog.create({
    tenantId,
    action: 'company.updated',
    resourceType: 'company',
    resourceDisplay: 'newer',
    changes: [{ field: 'gstin', before: '08MIDGSTIN0001Z', after: NEW_GSTIN }],
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
  });
  const token = await login(created.owner.email);
  const list = await api('GET', '/api/v1/audit-logs?limit=10', { token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data[0].resourceDisplay, 'newer');
  assert.equal(list.body.data[1].resourceDisplay, 'older');
  assert.ok(new Date(list.body.data[0].at) > new Date(list.body.data[1].at));

  const edited = await api('PATCH', `/api/v1/audit-logs/${older._id}`, { token, json: { action: 'tampered' } });
  const removed = await api('DELETE', `/api/v1/audit-logs/${older._id}`, { token });
  assert.equal(edited.status, 404);
  assert.equal(removed.status, 404);

  const row = await AuditLog.findById(older._id).setOptions({ skipTenantFilter: true });
  row.action = 'tampered';
  await assert.rejects(() => row.save(), /append-only/);
  await assert.rejects(() => AuditLog.updateOne({ _id: older._id }, { action: 'tampered' }).setOptions({ skipTenantFilter: true }), /append-only/);
  await assert.rejects(() => AuditLog.deleteOne({ _id: older._id }).setOptions({ skipTenantFilter: true }), /append-only/);
  await assert.rejects(() => AuditLog.findOneAndUpdate({ _id: older._id }, { action: 'tampered' }).setOptions({ skipTenantFilter: true }), /append-only/);
  await assert.rejects(() => AuditLog.bulkWrite([{ updateOne: { filter: { _id: older._id }, update: { $set: { action: 'tampered' } } } }]), /append-only/);
  await assert.rejects(() => AuditLog.collection.updateOne({ _id: older._id }, { $set: { action: 'tampered' } }), /append-only/);
  await assert.rejects(() => AuditLog.collection.deleteOne({ _id: older._id }), /append-only/);
  const fresh = await AuditLog.findById(older._id).setOptions({ skipTenantFilter: true });
  assert.equal(fresh.action, 'company.updated');
  assert.equal(fresh.resourceDisplay, 'older');
});
