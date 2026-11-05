process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const Order = require('../src/models/Order');
const Shipment = require('../src/models/Shipment');

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

test('orders list has Pickup & Manifest, In Transit, Delivered and RTO tabs with counts', async () => {
  const shop = await provisionMerchant({
    name: 'Tabs shop',
    ownerEmail: `tabs-${Date.now()}@example.com`,
    ownerName: 'Tabs Owner',
    password: 'Password1',
    status: 'active',
  });
  const other = await provisionMerchant({
    name: 'Other tabs shop',
    ownerEmail: `tabs-other-${Date.now()}@example.com`,
    ownerName: 'Other Owner',
    password: 'Password1',
    status: 'active',
  });
  const tenantId = shop.tenant._id;
  const row = { tenantId, channel: 'Shopify', source: 'manual', items: [{ name: 'Kurta', sku: 'K1', qty: 1, price: 100 }] };
  await Order.create([
    { ...row, orderNo: 'TAB-PICKUP', status: 'Dispatched', courier: 'Delhivery', awb: 'AWB-P' },
    { ...row, orderNo: 'TAB-TRANSIT', status: 'Dispatched', courier: 'Delhivery', awb: 'AWB-T' },
    { ...row, orderNo: 'TAB-ELSEWHERE', status: 'Dispatched', courier: 'Bluedart', awb: 'AWB-E' },
    { ...row, orderNo: 'TAB-DELIVERED', status: 'Delivered', awb: 'AWB-D' },
    { ...row, orderNo: 'TAB-RTO', status: 'Dispatched', awb: 'AWB-R', channelStatus: 'RTO' },
    { ...row, orderNo: 'TAB-MYNTRA-RTO', channel: 'Myntra', status: 'Cancelled', channelLines: [{ sku: 'K1', status: 'RTO' }] },
    { ...row, orderNo: 'TAB-NEW', status: 'New' },
  ]);
  await Order.create({ ...row, tenantId: other.tenant._id, orderNo: 'TAB-OTHER', status: 'Delivered' });
  await Shipment.create([
    { tenantId, orderNo: 'TAB-PICKUP', channel: 'shopify', courier: 'delhivery', awb: 'AWB-P', status: 'booked', deliveryStatus: '' },
    { tenantId, orderNo: 'TAB-TRANSIT', channel: 'shopify', courier: 'delhivery', awb: 'AWB-T', status: 'booked', deliveryStatus: 'in_transit' },
  ]);
  // Same order number in another tenant waiting for pickup must not move this tenant's order.
  await Shipment.create({ tenantId: other.tenant._id, orderNo: 'TAB-TRANSIT', channel: 'shopify', courier: 'delhivery', awb: 'AWB-X', status: 'booked', deliveryStatus: '' });

  const token = await login(shop.owner.email);
  const ids = async (status) => {
    const res = await api('GET', `/api/v1/orders?limit=50&status=${encodeURIComponent(status)}`, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return { ids: res.body.data.map((row) => row.orderNo).sort(), counts: res.body.meta.counts };
  };

  const pickup = await ids('Pickup & Manifest');
  assert.deepEqual(pickup.ids, ['TAB-PICKUP']);
  assert.deepEqual((await ids('In Transit')).ids, ['TAB-ELSEWHERE', 'TAB-TRANSIT']);
  assert.deepEqual((await ids('Delivered')).ids, ['TAB-DELIVERED']);
  assert.deepEqual((await ids('RTO')).ids, ['TAB-MYNTRA-RTO', 'TAB-RTO']);
  assert.equal((await ids('all')).ids.length, 7);

  assert.equal(pickup.counts['Pickup & Manifest'], 1);
  assert.equal(pickup.counts['In Transit'], 2);
  assert.equal(pickup.counts.Delivered, 1);
  assert.equal(pickup.counts.RTO, 2);
  assert.equal(pickup.counts.total, 7);
});

test('orders list filters by order date range (marketplace order date, local day)', async () => {
  const shop = await provisionMerchant({
    name: 'Date filter shop',
    ownerEmail: `date-${Date.now()}@example.com`,
    ownerName: 'Date Owner',
    password: 'Password1',
    status: 'active',
  });
  const tenantId = shop.tenant._id;
  const row = { tenantId, channel: 'Myntra', source: 'manual', status: 'New', items: [{ name: 'Kurta', sku: 'K1', qty: 1, price: 100 }] };
  await Order.create([
    { ...row, orderNo: 'DATE-OCT20', orderDate: new Date('2026-10-20T10:00:00.000Z') },
    // 21 Oct 01:00 IST is still 20 Oct in UTC.
    { ...row, orderNo: 'DATE-OCT21-IST', orderDate: new Date('2026-10-20T19:30:00.000Z') },
    { ...row, orderNo: 'DATE-OCT22', orderDate: new Date('2026-10-22T10:00:00.000Z') },
    { ...row, orderNo: 'DATE-OCT25', orderDate: new Date('2026-10-25T10:00:00.000Z') },
  ]);
  const token = await login(shop.owner.email);
  const ids = async (query) => {
    const res = await api('GET', `/api/v1/orders?limit=50&${query}`, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data.map((item) => item.orderNo).sort();
  };

  assert.deepEqual(await ids('from=2026-10-21&to=2026-10-22&tzOffset=-330'), ['DATE-OCT21-IST', 'DATE-OCT22']);
  assert.deepEqual(await ids('from=2026-10-22'), ['DATE-OCT22', 'DATE-OCT25']);
  assert.deepEqual(await ids('to=2026-10-20'), ['DATE-OCT20', 'DATE-OCT21-IST']);
  assert.equal((await ids('from=bad-date')).length, 4);
});

test('orders list filters by several statuses at once (comma separated)', async () => {
  const shop = await provisionMerchant({
    name: 'Multi status shop',
    ownerEmail: `multi-${Date.now()}@example.com`,
    ownerName: 'Multi Owner',
    password: 'Password1',
    status: 'active',
  });
  const tenantId = shop.tenant._id;
  const row = { tenantId, channel: 'Shopify', source: 'manual', items: [{ name: 'Kurta', sku: 'K1', qty: 1, price: 100 }] };
  await Order.create([
    // An unmapped SKU line puts an open order on the Unfulfillable status.
    { ...row, orderNo: 'MS-UNFULFILLABLE', status: 'New' },
    { ...row, orderNo: 'MS-CANCELLED', status: 'Cancelled' },
    { ...row, orderNo: 'MS-DELIVERED', status: 'Delivered', awb: 'AWB-MSD' },
    { ...row, orderNo: 'MS-RTO', status: 'Dispatched', awb: 'AWB-MSR', channelStatus: 'RTO' },
  ]);
  const token = await login(shop.owner.email);
  const ids = async (status) => {
    const res = await api('GET', `/api/v1/orders?limit=50&status=${encodeURIComponent(status)}`, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data.map((item) => item.orderNo).sort();
  };

  assert.deepEqual(await ids('Unfulfillable,Delivered'), ['MS-DELIVERED', 'MS-UNFULFILLABLE']);
  assert.deepEqual(await ids('Cancelled,RTO'), ['MS-CANCELLED', 'MS-RTO']);
  assert.deepEqual(await ids('Delivered'), ['MS-DELIVERED']);
  assert.equal((await ids('all')).length, 4);
});
