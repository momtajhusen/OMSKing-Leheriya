process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const Order = require('../src/models/Order');

let replSet;
let server;
let base;

async function api(method, path, { token } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json() };
}

async function login(email) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.data.accessToken;
}

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

test('GET /orders/manifests groups the day\'s Ready to Ship orders into one manifest per courier', async () => {
  const shop = await provisionMerchant({
    name: 'Manifest shop',
    ownerEmail: `manifest-${Date.now()}@example.com`,
    ownerName: 'Manifest Owner',
    password: 'Password1',
    status: 'active',
  });
  const other = await provisionMerchant({
    name: 'Other manifest shop',
    ownerEmail: `manifest-other-${Date.now()}@example.com`,
    ownerName: 'Other Owner',
    password: 'Password1',
    status: 'active',
  });
  const tenantId = shop.tenant._id;
  const day = '2026-11-03';
  const today = new Date('2026-11-03T10:00:00+05:30');
  const yesterday = new Date('2026-11-02T10:00:00+05:30');
  const row = {
    tenantId, channel: 'Myntra', source: 'manual', customer: 'Asha', city: 'Jaipur',
    items: [{ name: 'Kurta', sku: 'K1', qty: 2, price: 500, masterSkuId: new mongoose.Types.ObjectId() }], total: 1000,
  };
  await Order.create([
    { ...row, orderNo: 'MF-D1', status: 'Ready to Ship', courier: 'Delhivery', awb: 'AWB-D1', paymentMode: 'COD', labelGeneratedAt: today },
    { ...row, orderNo: 'MF-D2', status: 'Ready to Ship', courier: 'Delhivery', awb: 'AWB-D2', paymentMode: 'Prepaid', labelGeneratedAt: today },
    { ...row, orderNo: 'MF-B1', status: 'Ready to Ship', courier: 'Bluedart', awb: 'AWB-B1', paymentMode: 'COD', labelGeneratedAt: yesterday },
    { ...row, orderNo: 'MF-SHOPIFY', channel: 'Shopify', status: 'Dispatched', courier: 'Delhivery', awb: 'AWB-S1', paymentMode: 'Prepaid', labelGeneratedAt: today },
    { ...row, orderNo: 'MF-OLD-DISPATCH', status: 'Dispatched', courier: 'Delhivery', awb: 'AWB-OLD', labelGeneratedAt: yesterday },
    { ...row, orderNo: 'MF-NO-AWB', status: 'Ready to Ship' },
    { ...row, orderNo: 'MF-NEW', status: 'New' },
  ]);
  await Order.create({ ...row, tenantId: other.tenant._id, orderNo: 'MF-OTHER', status: 'Ready to Ship', courier: 'Delhivery', awb: 'AWB-X', labelGeneratedAt: today });

  assert.equal((await api('GET', `/api/v1/orders/manifests?date=${day}`)).status, 401);

  const token = await login(shop.owner.email);
  const res = await api('GET', `/api/v1/orders/manifests?date=${day}`, { token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { manifests, withoutAwb, date } = res.body.data;
  assert.equal(date, day);
  assert.equal(withoutAwb, 1);
  assert.deepEqual(manifests.map((m) => m.courier), ['Bluedart', 'Delhivery']);

  const delhivery = manifests.find((m) => m.courier === 'Delhivery');
  assert.equal(delhivery.manifestId, 'MF-20261103-DELHIVERY');
  assert.equal(delhivery.count, 3);
  assert.deepEqual(delhivery.rows.map((r) => r.orderNo).sort(), ['MF-D1', 'MF-D2', 'MF-SHOPIFY']);
  const cod = delhivery.rows.find((r) => r.orderNo === 'MF-D1');
  assert.equal(cod.awb, 'AWB-D1');
  assert.equal(cod.codAmount, 1000);
  assert.equal(cod.qty, 2);
  assert.equal(cod.city, 'Jaipur');
  assert.equal(delhivery.rows.find((r) => r.orderNo === 'MF-D2').codAmount, 0);
  assert.equal(delhivery.codTotal, 1000);

  const bluedart = manifests.find((m) => m.courier === 'Bluedart');
  assert.deepEqual(bluedart.rows.map((r) => r.orderNo), ['MF-B1']);

  const all = manifests.flatMap((m) => m.rows.map((r) => r.orderNo));
  assert.ok(!all.includes('MF-OTHER'));
  assert.ok(!all.includes('MF-OLD-DISPATCH'));
});
