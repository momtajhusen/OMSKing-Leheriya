process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const amazon = require('../src/adapters/amazon');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { hashPassword } = require('../src/lib/password');
const User = require('../src/models/User');
const Order = require('../src/models/Order');
const Shipment = require('../src/models/Shipment');
const AuditLog = require('../src/models/AuditLog');

const PASSWORD = 'Password1';
let memory;
let server;
let base;
let amazonCalls = 0;
const realEasyShip = amazon.easyShip;

async function api(method, path, { token, json } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let body = null;
  try { body = JSON.parse(buf.toString('utf8')); } catch { body = null; }
  return { status: res.status, type: res.headers.get('content-type') || '', buf, body };
}

async function login(email) {
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken;
}

async function company(label) {
  const created = await provisionMerchant({
    name: `Easy Ship API ${label}`,
    ownerEmail: `owner-${label}-${Date.now()}@example.com`,
    ownerName: 'Owner',
    password: PASSWORD,
    status: 'active',
  });
  const role = created.roles.find((row) => row.code === 'operations');
  const email = `ops-${label}-${Date.now()}@example.com`;
  await User.create({
    tenantId: created.tenant._id, fullName: 'Ops', email, passwordHash: await hashPassword(PASSWORD), roleId: role._id, status: 'active', emailVerified: true,
  });
  return { tenant: created.tenant, token: await login(email) };
}

const amazonOrder = (tenantId, orderNo, extra = {}) => Order.create({
  tenantId, orderNo, channel: 'Amazon', externalOrderId: `407-${orderNo}`, source: 'channel_api', status: 'Ready to Ship', items: [{ sku: 'NOPACK', qty: 1 }], ...extra,
});

const bookedLabel = (tenantId, orderNo, labelPdf) => Shipment.create({
  tenantId, orderNo, channel: 'amazon', courier: 'amazon', awb: `AWB-${orderNo}`, status: 'booked', labelPdf, channelPackageId: `PKG-${orderNo}`,
});

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  amazon.easyShip = async () => { amazonCalls += 1; throw new Error('Amazon must not be called in this test'); };
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  amazon.easyShip = realEasyShip;
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('the Easy Ship endpoints need a login', async () => {
  for (const [method, path] of [['POST', '/api/v1/orders/labels/amazon'], ['GET', '/api/v1/orders/X/amazon-label'], ['POST', '/api/v1/orders/X/ship'], ['POST', '/api/v1/orders/X/label/cancel']]) {
    const res = await api(method, path, { json: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('Easy Ship label on an order without package size is refused with a clear reason and Amazon is not called', async () => {
  const { tenant, token } = await company('nopack');
  await amazonOrder(tenant._id, 'AMZ-API-NOPACK');
  const res = await api('POST', '/api/v1/orders/AMZ-API-NOPACK/ship', { token, json: {} });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /Package weight and size are missing/);
  assert.equal(amazonCalls, 0);
});

test('bulk Amazon labels report each order on its own and need at least one order', async () => {
  const { tenant, token } = await company('bulk');
  await amazonOrder(tenant._id, 'AMZ-API-B1');
  await Order.create({ tenantId: tenant._id, orderNo: 'SHP-API-B2', channel: 'Shopify' });
  const res = await api('POST', '/api/v1/orders/labels/amazon', { token, json: { orderIds: ['AMZ-API-B1', 'SHP-API-B2', 'NOPE'] } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.done, []);
  assert.deepEqual(res.body.data.failed.map((row) => row.orderNo), ['AMZ-API-B1', 'SHP-API-B2', 'NOPE']);
  assert.match(res.body.message, /0 Amazon Easy Ship labels made · 3 not made/);
  const empty = await api('POST', '/api/v1/orders/labels/amazon', { token, json: { orderIds: [] } });
  assert.equal(empty.status, 400);
  assert.equal(amazonCalls, 0);
});

test('reprint serves the stored label PDF; an order without one gets a clear 404', async () => {
  const { tenant, token } = await company('print');
  await amazonOrder(tenant._id, 'AMZ-API-P1', { awb: 'AWB-AMZ-API-P1', labelGeneratedAt: new Date() });
  await bookedLabel(tenant._id, 'AMZ-API-P1', Buffer.from('%PDF-1.4 stored label'));
  const pdf = await api('GET', '/api/v1/orders/AMZ-API-P1/amazon-label', { token });
  assert.equal(pdf.status, 200);
  assert.match(pdf.type, /application\/pdf/);
  assert.equal(pdf.buf.toString(), '%PDF-1.4 stored label');

  await amazonOrder(tenant._id, 'AMZ-API-P2');
  const none = await api('GET', '/api/v1/orders/AMZ-API-P2/amazon-label', { token });
  assert.equal(none.status, 404);
  assert.match(none.body.message, /no Amazon label yet/);
  assert.equal(amazonCalls, 0);
});

test('cancel clears the Amazon label, keeps the package id and writes an audit row', async () => {
  const { tenant, token } = await company('cancel');
  await amazonOrder(tenant._id, 'AMZ-API-C1', { awb: 'AWB-AMZ-API-C1', labelGeneratedAt: new Date(), easyShip: { packageId: 'PKG-AMZ-API-C1' } });
  await bookedLabel(tenant._id, 'AMZ-API-C1', Buffer.from('%PDF-1.4 x'));
  const res = await api('POST', '/api/v1/orders/AMZ-API-C1/label/cancel', { token, json: {} });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.awb, '');
  assert.match(res.body.message, /Easy Ship has no cancel call/);
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'AMZ-API-C1' });
  assert.equal(order.easyShip.packageId, 'PKG-AMZ-API-C1');
  assert.equal(await AuditLog.countDocuments({ tenantId: tenant._id, action: 'order.label_cancelled', resourceDisplay: 'AMZ-API-C1' }), 1);
  const again = await api('POST', '/api/v1/orders/AMZ-API-C1/label/cancel', { token, json: {} });
  assert.equal(again.status, 400);
});

test('another company cannot label, print or cancel this company\'s Amazon order', async () => {
  const owner = await company('own');
  const other = await company('other');
  await amazonOrder(owner.tenant._id, 'AMZ-API-X1', { awb: 'AWB-AMZ-API-X1', labelGeneratedAt: new Date() });
  await bookedLabel(owner.tenant._id, 'AMZ-API-X1', Buffer.from('%PDF-1.4 private'));
  for (const [method, path] of [['GET', '/api/v1/orders/AMZ-API-X1/amazon-label'], ['POST', '/api/v1/orders/AMZ-API-X1/ship'], ['POST', '/api/v1/orders/AMZ-API-X1/label/cancel']]) {
    const res = await api(method, path, { token: other.token, json: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  const bulk = await api('POST', '/api/v1/orders/labels/amazon', { token: other.token, json: { orderIds: ['AMZ-API-X1'] } });
  assert.equal(bulk.body.data.failed[0].reason, 'Order not found');
  assert.equal(await Shipment.countDocuments({ orderNo: 'AMZ-API-X1', status: 'booked' }), 1);
  assert.equal(amazonCalls, 0);
});
