process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { orderPackage } = require('../src/services/packageDefaults.service');
const Order = require('../src/models/Order');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const AuditLog = require('../src/models/AuditLog');

const PASSWORD = 'Password1';
const DEFAULTS = { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 5 };

let memory;
let server;
let base;

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
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function merchant(label) {
  const ownerEmail = `pack-${label}-${Date.now()}@example.com`;
  const created = await provisionMerchant({ name: `Pack ${label}`, ownerEmail, ownerName: 'Owner', password: PASSWORD, status: 'active' });
  await Tenant.updateOne({ _id: created.tenant._id }, { $set: { 'settings.packageDefaults': DEFAULTS } });
  const res = await api('POST', '/api/v1/auth/login', { json: { email: ownerEmail, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { tenantId: created.tenant._id, token: res.body.data.accessToken };
}

async function order(tenantId, orderNo, extra = {}) {
  const own = await MasterSku.create({ tenantId, code: `${orderNo}-OWN`, name: 'Saree', weightKg: 1.2, dimensionsCm: { l: 40, w: 30, h: 10 } });
  return Order.create({
    tenantId,
    orderNo,
    channel: 'Shopify',
    status: 'New',
    customer: 'Ekta Sharma',
    address: 'Manav City, D-605',
    city: 'Sikar 332001',
    total: 5999,
    items: [
      { name: 'Saree', sku: own.code, masterSkuId: own._id, qty: 1, price: 3999 },
      { name: 'Dupatta', sku: 'LEHBRIDAL21', qty: 2, price: 1000 },
    ],
    ...extra,
  });
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('order detail shows each item weight and L/B/H from the product, else the tenant default', async () => {
  const { tenantId, token } = await merchant('show');
  await order(tenantId, 'SHP-P-1');
  const got = await api('GET', '/api/v1/orders/SHP-P-1', { token });
  assert.equal(got.status, 200, JSON.stringify(got.body));
  const [saree, dupatta] = got.body.data.items;
  assert.deepEqual(saree.package, { weightKg: 1.2, lengthCm: 40, breadthCm: 30, heightCm: 10, source: 'product' });
  assert.deepEqual(dupatta.package, { ...DEFAULTS, source: 'default' });
});

test('PATCH /orders/:id/items/:index/package edits one line, audits it, feeds the courier and can be reset', async () => {
  const { tenantId, token } = await merchant('edit');
  await order(tenantId, 'SHP-P-2');
  const res = await api('PATCH', '/api/v1/orders/SHP-P-2/items/1/package', {
    token,
    json: { weightKg: 0.8, lengthCm: 35, breadthCm: 28, heightCm: 6 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.items[1].package, { weightKg: 0.8, lengthCm: 35, breadthCm: 28, heightCm: 6, source: 'order' });
  assert.equal(res.body.data.items[0].package.source, 'product', 'other lines are untouched');

  const audit = await AuditLog.findOne({ tenantId, action: 'order.package_updated' }).setOptions({ skipTenantFilter: true }).lean();
  assert.ok(audit, 'package change is audited');
  assert.equal(audit.before.weightKg, 0.5);
  assert.equal(audit.after.weightKg, 0.8);

  const saved = await Order.findOne({ tenantId, orderNo: 'SHP-P-2' }).setOptions({ skipTenantFilter: true }).lean();
  const pack = await orderPackage(tenantId, saved.items);
  assert.deepEqual(pack, { weightGrams: 2800, lengthCm: 40, breadthCm: 30, heightCm: 22 }, '1.2 kg + 2 × 0.8 kg; heights 10 + 2 × 6');

  const reset = await api('PATCH', '/api/v1/orders/SHP-P-2/items/1/package', { token, json: {} });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.deepEqual(reset.body.data.items[1].package, { ...DEFAULTS, source: 'default' });
});

test('package edit rejects bad values, a missing line and a labelled order', async () => {
  const { tenantId, token } = await merchant('guard');
  await order(tenantId, 'SHP-P-3');
  await order(tenantId, 'SHP-P-4', { awb: 'AWB-1' });
  const bad = await api('PATCH', '/api/v1/orders/SHP-P-3/items/0/package', { token, json: { weightKg: -1 } });
  assert.equal(bad.status, 400);
  const missing = await api('PATCH', '/api/v1/orders/SHP-P-3/items/9/package', { token, json: { weightKg: 1 } });
  assert.equal(missing.status, 404);
  const labelled = await api('PATCH', '/api/v1/orders/SHP-P-4/items/0/package', { token, json: { weightKg: 1 } });
  assert.equal(labelled.status, 400);
});

test('package edit needs a login and never reaches another tenant', async () => {
  const { token } = await merchant('mine');
  const other = await merchant('other');
  await order(other.tenantId, 'SHP-P-OTHER');
  const anon = await api('PATCH', '/api/v1/orders/SHP-P-OTHER/items/0/package', { json: { weightKg: 1 } });
  assert.equal(anon.status, 401);
  const cross = await api('PATCH', '/api/v1/orders/SHP-P-OTHER/items/0/package', { token, json: { weightKg: 9 } });
  assert.equal(cross.status, 404);
  const untouched = await Order.findOne({ tenantId: other.tenantId, orderNo: 'SHP-P-OTHER' }).setOptions({ skipTenantFilter: true }).lean();
  assert.ok(!(Number(untouched.items[0].pack?.weightKg) > 0));
});
