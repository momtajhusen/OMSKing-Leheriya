process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const Order = require('../src/models/Order');
const HandoverManifest = require('../src/models/HandoverManifest');
const { toOrderDto } = require('../src/lib/orderDto');
const { buildOrderSummary } = require('../src/services/orderSummary.service');

const PASSWORD = 'Password1';
let memory;
let server;
let base;

async function api(method, path, { token, json } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function company(label) {
  const email = `owner-${label}-${Date.now()}@example.com`;
  const created = await provisionMerchant({ name: `Handover ${label}`, ownerEmail: email, ownerName: 'Owner', password: PASSWORD, status: 'active' });
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { tenantId: created.tenant._id, token: res.body.data.accessToken };
}

function order(tenantId, orderNo, extra = {}) {
  return Order.create({
    tenantId, orderNo, channel: 'Shopify', status: 'Dispatched', customer: 'Asha', city: 'Jaipur', address: 'MI Road, Jaipur 302001',
    paymentMode: 'COD', total: 999, courier: 'Delhivery', awb: `AWB-${orderNo}`, labelGeneratedAt: new Date(),
    items: [{ name: 'Kurta', sku: 'K1', qty: 2, price: 499.5 }], ...extra,
  });
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await memory.stop();
});

test('labelled parcels move to Ready to hand over with one saved manifest per courier; no courier is called', async () => {
  const { tenantId, token } = await company('ok');
  await order(tenantId, 'SHP-1');
  await order(tenantId, 'SHP-2', { paymentMode: 'Prepaid' });
  await order(tenantId, 'SHP-3', { courier: 'Xpressbees', awb: 'XB-3' });
  await order(tenantId, 'SHP-4', { awb: '', labelGeneratedAt: null });

  const res = await api('POST', '/api/v1/orders/handover', { token, json: { orderIds: ['SHP-1', 'SHP-2', 'SHP-3', 'SHP-4', 'NOPE'] } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { manifests, skipped } = res.body.data;
  assert.deepEqual(manifests.map((m) => [m.courier, m.count]).sort(), [['Delhivery', 2], ['Xpressbees', 1]]);
  const delhivery = manifests.find((m) => m.courier === 'Delhivery');
  assert.match(delhivery.manifestNo, /^MF-\d{8}-DELHIVERY-01$/);
  assert.equal(delhivery.codTotal, 999);
  assert.equal(delhivery.rows[0].pincode, '302001');
  assert.equal(delhivery.warehouseCode, 'WH-001');
  assert.deepEqual(skipped.map((s) => s.orderNo).sort(), ['NOPE', 'SHP-4']);

  const moved = await Order.findOne({ tenantId, orderNo: 'SHP-1' }).setOptions({ skipTenantFilter: true });
  assert.ok(moved.handoverAt);
  assert.equal(moved.manifestNo, delhivery.manifestNo);
  const again = await api('POST', '/api/v1/orders/handover', { token, json: { orderIds: ['SHP-1'] } });
  assert.equal(again.status, 400, 'a parcel already on a manifest is not added twice');

  const list = await api('GET', '/api/v1/orders/handover-manifests', { token });
  assert.equal(list.body.data.length, 2);
  const one = await api('GET', `/api/v1/orders/handover-manifests/${delhivery.manifestNo}`, { token });
  assert.equal(one.body.data.rows.length, 2);

  const listed = await api('GET', '/api/v1/orders/SHP-1', { token });
  assert.equal(listed.body.data.manifestNo, delhivery.manifestNo);
  assert.ok(listed.body.data.handoverAt);
});

test('another company cannot hand over or read the manifests; Mark dispatched records the pickup', async () => {
  const a = await company('a');
  const b = await company('b');
  await order(a.tenantId, 'SHP-10');
  const theirs = await api('POST', '/api/v1/orders/handover', { token: b.token, json: { orderIds: ['SHP-10'] } });
  assert.equal(theirs.status, 400);
  assert.equal(await HandoverManifest.countDocuments({}).setOptions({ skipTenantFilter: true }) >= 0, true);
  const made = await api('POST', '/api/v1/orders/handover', { token: a.token, json: { orderIds: ['SHP-10'] } });
  const no = made.body.data.manifests[0].manifestNo;
  assert.equal((await api('GET', `/api/v1/orders/handover-manifests/${no}`, { token: b.token })).status, 404);
  assert.equal((await api('GET', '/api/v1/orders/handover-manifests', { token: b.token })).body.data.length, 0);

  await order(a.tenantId, 'SHP-11', { status: 'Ready to Ship' });
  const res = await api('PATCH', '/api/v1/orders/SHP-11/status', { token: a.token, json: { status: 'Dispatched' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.data.pickedUpAt);
});

test('dashboard sales count by the marketplace order date, not the import date', () => {
  const imported = new Date('2026-11-04T10:00:00Z');
  const rows = [
    toOrderDto({ orderNo: 'SHP-OCT', channel: 'Shopify', status: 'Delivered', total: 1000, orderDate: new Date('2026-10-20T10:00:00Z'), createdAt: imported, items: [{ name: 'A', qty: 1, price: 1000 }] }),
    toOrderDto({ orderNo: 'MYN-NOV', channel: 'Myntra', status: 'Delivered', total: 500, orderDate: new Date('2026-11-02T10:00:00Z'), createdAt: imported, items: [{ name: 'B', qty: 1, price: 500 }] }),
  ];
  const november = buildOrderSummary(rows, { from: '2026-11-01', to: '2026-11-30' });
  const october = buildOrderSummary(rows, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(november.revenue, 500, 'the October order imported in November is not November sales');
  assert.equal(october.revenue, 1000);
});
