process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const Order = require('../src/models/Order');
const AuditLog = require('../src/models/AuditLog');

const PASSWORD = 'Password1';

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

async function merchant(label = 'rev') {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const ownerEmail = `${label}-${stamp}@example.com`;
  const created = await provisionMerchant({
    name: `Reverse ${stamp}`, ownerEmail, ownerName: 'Owner', password: PASSWORD, status: 'active',
  });
  const res = await api('POST', '/api/v1/auth/login', { json: { email: ownerEmail, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { tenantId: created.tenant._id, token: res.body.data.accessToken };
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

test('book reverse stores courier AWB, and cancel removes it', async () => {
  const { tenantId, token } = await merchant();
  await Order.create({
    tenantId,
    orderNo: 'SHP-19098769686621',
    channel: 'Shopify',
    status: 'Delivered',
    customer: 'Cessna Mehta',
    address: 'Delhi',
    city: 'Delhi',
    total: 5999,
    courier: 'Delhivery',
    items: [{ name: 'Bridal', sku: 'LEHBRIDAL21', qty: 1, price: 5999 }],
  });

  const missingAwb = await api('POST', '/api/v1/orders/SHP-19098769686621/reverse', {
    token,
    json: { reason: 'Customer reverse pickup', courier: 'Bluedart' },
  });
  assert.equal(missingAwb.status, 400);

  const booked = await api('POST', '/api/v1/orders/SHP-19098769686621/reverse', {
    token,
    json: { reason: 'Customer reverse pickup', courier: 'Bluedart', awb: 'REV-TRACK-1' },
  });
  assert.equal(booked.status, 200, JSON.stringify(booked.body));
  assert.equal(booked.body.data.reversePickup.returnId, 'RET-REV-SHP-19098769686621');
  assert.equal(booked.body.data.reversePickup.awb, 'REV-TRACK-1');
  assert.equal(booked.body.data.reversePickup.courier, 'Bluedart');
  assert.ok(booked.body.data.reverseLabelHtml);

  const patched = await api('PATCH', '/api/v1/orders/SHP-19098769686621/reverse', {
    token,
    json: { courier: 'Bluedart', awb: 'REV-TRACK-2' },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.data.reversePickup.awb, 'REV-TRACK-2');

  const cancelled = await api('DELETE', '/api/v1/orders/SHP-19098769686621/reverse', { token });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.reversePickup, null);

  const saved = await Order.findOne({ tenantId, orderNo: 'SHP-19098769686621' }).lean();
  assert.equal(saved.reversePickup?.returnId || '', '');

  const audit = await AuditLog.findOne({ tenantId, action: 'order.reverse_cancelled' }).lean();
  assert.ok(audit);
  assert.equal(audit.before.returnId, 'RET-REV-SHP-19098769686621');
});

test('cancel reverse fails when none is booked', async () => {
  const { tenantId, token } = await merchant('norev');
  await Order.create({
    tenantId,
    orderNo: 'SHP-NO-REV',
    channel: 'Shopify',
    status: 'Delivered',
    customer: 'A',
    total: 100,
    items: [{ name: 'X', sku: 'X1', qty: 1, price: 100 }],
  });
  const res = await api('DELETE', '/api/v1/orders/SHP-NO-REV/reverse', { token });
  assert.equal(res.status, 400);
});
