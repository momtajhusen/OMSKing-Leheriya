process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { hashPassword } = require('../src/lib/password');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const Vendor = require('../src/models/Vendor');
const Order = require('../src/models/Order');
const app = require('../src/app');

let memory;
let server;
let base;
let vendorA;
let vendorB;

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

async function login(email) {
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password: 'Password1' } });
  assert.equal(res.status, 200);
  return res.body.data.accessToken;
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenant = await Tenant.create({
    name: 'Vendor Desk',
    slug: `vendor-desk-${Date.now()}`,
    kind: 'merchant',
    status: 'active',
  });
  const role = await Role.create({
    tenantId: tenant._id,
    code: 'vendor',
    name: 'Vendor',
    permissions: ['orders.view', 'orders.edit', 'shipping.generate'],
    isSystem: true,
  });
  vendorA = await Vendor.create({ tenantId: tenant._id, name: 'Vendor A', nameNorm: 'vendor a' });
  vendorB = await Vendor.create({ tenantId: tenant._id, name: 'Vendor B', nameNorm: 'vendor b', phone: '9811100002' });
  await User.create({
    tenantId: tenant._id,
    fullName: 'Vendor A',
    email: 'vendor-a@example.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
    assignedVendorIds: [vendorA._id],
  });
  await User.create({
    tenantId: tenant._id,
    fullName: 'Vendor B',
    email: 'vendor-b@example.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
    assignedVendorIds: [vendorB._id],
  });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'VEN-1',
    channel: 'Shopify',
    source: 'manual',
    customer: 'Hidden Buyer',
    phone: '9000000099',
    status: 'Delivered',
    items: [
      { name: 'A Saree', sku: 'SKU-A', qty: 1, price: 100 },
      { name: 'B Shawl', sku: 'SKU-B', qty: 1, price: 80 },
    ],
    subOrders: [
      { id: 'A-1', index: 1, sku: 'SKU-A', title: 'A Saree', price: 100, qty: 1, assignedVendor: 'Vendor A', vendorStatus: 'Accepted' },
      { id: 'A-2', index: 2, sku: 'SKU-A2', title: 'A Dupatta', price: 40, qty: 1, assignedVendor: 'Vendor A', vendorStatus: 'Accepted' },
      { id: 'B-1', index: 3, sku: 'SKU-B', title: 'B Shawl', price: 80, qty: 1, assignedVendor: 'Vendor B', vendorPhone: '9811100002', vendorStatus: 'Delivered' },
    ],
    reversePickup: { returnId: 'RET-B', awb: 'REV-SECRET', reason: 'Vendor B size', courier: 'Delhivery' },
  });
});

test.after(async () => {
  server.close();
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('dispatch without tracking is rejected and a saved tracking dispatches the line', async () => {
  const token = await login('vendor-a@example.com');
  const blank = await api('PATCH', '/api/v1/orders/VEN-1/sub-orders/A-1/vendor', {
    token,
    json: { action: 'dispatch', trackingNumber: '   ', courier: 'Delhivery' },
  });
  assert.equal(blank.status, 400);
  assert.match(blank.body.message, /Tracking number/);

  const noCourier = await api('PATCH', '/api/v1/orders/VEN-1/sub-orders/A-1/vendor', {
    token,
    json: { action: 'dispatch', trackingNumber: 'AWB-ONE' },
  });
  assert.equal(noCourier.status, 400);
  assert.match(noCourier.body.message, /Tracking number/);

  const stored = await Order.findOne({ orderNo: 'VEN-1' }).setOptions({ skipTenantFilter: true });
  const untouched = stored.subOrders.find((row) => row.id === 'A-1');
  assert.equal(untouched.vendorStatus, 'Accepted');
  assert.equal(untouched.trackingNumber || '', '');

  const sent = await api('PATCH', '/api/v1/orders/VEN-1/sub-orders/A-1/vendor', {
    token,
    json: { action: 'dispatch', trackingNumber: 'AWB-SHARED', courier: 'Delhivery', dispatchDate: '2026-10-10' },
  });
  assert.equal(sent.status, 200);
  const line = sent.body.data.subOrders.find((row) => row.id === 'A-1');
  assert.equal(line.vendorStatus, 'Dispatched');
  assert.equal(line.trackingNumber, 'AWB-SHARED');
  assert.equal(line.courier, 'Delhivery');
  assert.equal(line.dispatchDate, '2026-10-10');
});

test('one tracking number can be saved on every selected line', async () => {
  const token = await login('vendor-a@example.com');
  const second = await api('PATCH', '/api/v1/orders/VEN-1/sub-orders/A-2/vendor', {
    token,
    json: { action: 'dispatch', trackingNumber: 'AWB-SHARED', courier: 'Delhivery' },
  });
  assert.equal(second.status, 200);
  const lines = second.body.data.subOrders.filter((row) => row.assignedVendor === 'Vendor A');
  assert.deepEqual(lines.map((row) => row.trackingNumber).sort(), ['AWB-SHARED', 'AWB-SHARED']);
});

test('vendor orders, returns and products stay on that vendor', async () => {
  const tokenA = await login('vendor-a@example.com');
  const tokenB = await login('vendor-b@example.com');

  const ordersA = await api('GET', '/api/v1/orders', { token: tokenA });
  assert.equal(ordersA.status, 200);
  const textA = JSON.stringify(ordersA.body);
  assert.match(textA, /SKU-A/);
  assert.equal(textA.includes('SKU-B'), false);
  assert.equal(textA.includes('9811100002'), false);
  assert.equal(textA.includes('B Shawl'), false);
  assert.match(textA, /RET-B/);

  const ordersB = await api('GET', '/api/v1/orders', { token: tokenB });
  const textB = JSON.stringify(ordersB.body);
  assert.match(textB, /SKU-B/);
  assert.equal(textB.includes('SKU-A2'), false);
  assert.equal(textB.includes('A Saree'), false);

  const vendorsA = await api('GET', '/api/v1/vendors', { token: tokenA });
  assert.equal(vendorsA.status, 200);
  assert.deepEqual(vendorsA.body.data.map((row) => row.name), ['Vendor A']);

  const products = await api('GET', '/api/v1/products', { token: tokenA });
  assert.equal(products.status, 403);
  assert.equal(JSON.stringify(products.body).includes('SKU-B'), false);
});
