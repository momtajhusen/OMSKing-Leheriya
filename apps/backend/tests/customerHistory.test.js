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
const Order = require('../src/models/Order');
const app = require('../src/app');
const { historyOf } = require('../src/services/customerHistory.service');

let memory;
let server;
let base;
let tenant;

async function api(path, token) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

async function login(email) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).data.accessToken;
}

async function userWith(tenantId, code, email, extra = {}) {
  const role = await Role.create({ tenantId, code, name: code, permissions: ['orders.view', 'orders.edit'], isSystem: true });
  await User.create({
    tenantId,
    fullName: email,
    email,
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
    ...extra,
  });
}

const order = (tenantId, orderNo, status, day, extra = {}) => ({
  tenantId,
  orderNo,
  status,
  customer: 'Tejashree',
  phone: '9923900087',
  orderDate: new Date(`2026-10-${String(day).padStart(2, '0')}T10:00:00Z`),
  ...extra,
});

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  tenant = await Tenant.create({ name: 'History Co', slug: `history-${Date.now()}`, kind: 'merchant', status: 'active' });
  const other = await Tenant.create({ name: 'Other Co', slug: `history-other-${Date.now()}`, kind: 'merchant', status: 'active' });
  await userWith(tenant._id, 'ops', 'ops@history.test');
  await userWith(tenant._id, 'vendor', 'vendor@history.test', { assignedVendorIds: [] });

  await Order.create([
    order(tenant._id, 'H-1', 'Delivered', 1),
    order(tenant._id, 'H-2', 'Cancelled', 2, { phone: '+91 99239 00087' }),
    order(tenant._id, 'H-3', 'In transit', 3, { phone: '', email: 'TEJ@example.com' }),
    order(tenant._id, 'H-NOW', 'New', 10, { email: 'tej@example.com' }),
    order(tenant._id, 'H-LATER', 'Delivered', 20),
    order(tenant._id, 'X-1', 'Delivered', 4, { phone: '9811111111', customer: 'Someone else' }),
    order(other._id, 'O-1', 'Delivered', 5),
  ]);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await memory.stop();
});

test('risk follows the settled past orders: all cancelled is High, some delivered is Medium, all delivered is Low', () => {
  assert.equal(historyOf([]).risk, '');
  assert.equal(historyOf([{ status: 'Cancelled' }, { status: 'RTO' }]).risk, 'High');
  assert.equal(historyOf([{ status: 'Cancelled' }, { status: 'Delivered' }]).risk, 'Medium');
  assert.equal(historyOf([{ status: 'Delivered' }, { status: 'Delivered' }]).risk, 'Low');
  assert.equal(historyOf([{ status: 'In transit' }]).risk, '', 'nothing settled yet, no risk call');
});

test('customer history counts this customer\'s earlier orders in this company only, matched by phone or email', async () => {
  const token = await login('ops@history.test');
  const res = await api('/api/v1/orders/H-NOW/customer-history', token);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, {
    pastOrders: 3,
    delivered: 1,
    cancelled: 1,
    lastOrderStatus: 'In transit',
    lastOrderNo: 'H-3',
    risk: 'Medium',
  });
});

test('vendors cannot read customer history', async () => {
  const token = await login('vendor@history.test');
  const res = await api('/api/v1/orders/H-NOW/customer-history', token);
  assert.equal(res.status, 403);
});
