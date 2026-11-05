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
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const shopify = require('../src/adapters/shopify');
const app = require('../src/app');

const creds = { shopUrl: 'demo.myshopify.com', adminToken: 'shpat_test' };

function fakeShopify(cost) {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes('/variants/111.json')) return { status: 200, text: JSON.stringify({ variant: { id: 111, inventory_item_id: 999 } }) };
    if (url.includes('/inventory_items/999.json') && method === 'GET') {
      return { status: 200, text: JSON.stringify({ inventory_item: { id: 999, cost } }) };
    }
    if (url.includes('/inventory_items/999.json') && method === 'PUT') return { status: 200, text: '{}' };
    return { status: 404, text: '{}' };
  };
  return { calls, request };
}

test('readVariantCost reads the Shopify cost per item, and null when it is blank', async () => {
  const filled = fakeShopify('600.00');
  assert.equal(await shopify.readVariantCost(creds, { variantId: '111', request: filled.request }), 600);
  const blank = fakeShopify(null);
  assert.equal(await shopify.readVariantCost(creds, { variantId: '111', request: blank.request }), null);
});

test('pushVariantCost writes the cost to the Shopify inventory item', async () => {
  const fake = fakeShopify(null);
  const out = await shopify.pushVariantCost(creds, { variantId: '111', cost: 450, request: fake.request });
  assert.equal(out.cost, 450);
  const put = fake.calls.find((row) => row.method === 'PUT');
  assert.ok(put.url.endsWith('/inventory_items/999.json'));
  assert.deepEqual(put.body, { inventory_item: { id: 999, cost: '450.00' } });
});

let memory;
let server;
let base;
let token;
let tenantId;
const original = { read: shopify.readVariantCost, push: shopify.pushVariantCost };

async function api(method, path, json) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${token}`,
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function makeOrder(orderNo, { mapped = true } = {}) {
  const sku = await MasterSku.create({ tenantId, code: `${orderNo}-SKU`, name: 'Silk Saree' });
  if (mapped) {
    await SkuMapping.create({
      tenantId,
      masterSkuId: sku._id,
      channel: 'shopify',
      channelVariantId: `${orderNo === 'COST-1' ? '111' : `v-${orderNo}`}`,
      channelSkuCode: `${orderNo}-SKU`,
      channelSkuCodeNorm: `${orderNo}-sku`,
      syncStatus: 'synced',
    });
  }
  await Order.create({
    tenantId,
    orderNo,
    channel: 'Shopify',
    source: 'manual',
    customer: 'Buyer',
    status: 'New',
    fulfilmentSource: 'Virtual',
    items: [{ name: 'Silk Saree', sku: `${orderNo}-SKU`, qty: 1, price: 2199, masterSkuId: sku._id }],
    subOrders: [{ id: `${orderNo}-1`, index: 1, sku: `${orderNo}-SKU`, masterSkuId: sku._id, title: 'Silk Saree', price: 2199, qty: 1 }],
  });
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const tenant = await Tenant.create({ name: 'Cost Desk', slug: `cost-desk-${Date.now()}`, kind: 'merchant', status: 'active' });
  tenantId = tenant._id;
  const role = await Role.create({ tenantId, code: 'ops', name: 'Ops', permissions: ['orders.view', 'orders.edit'], isSystem: true });
  await User.create({
    tenantId,
    fullName: 'Ops',
    email: 'ops-cost@example.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ops-cost@example.com', password: 'Password1' }),
  });
  token = (await res.json()).data.accessToken;
  await makeOrder('COST-1');
  await makeOrder('COST-2');
  await makeOrder('COST-3', { mapped: false });
});

test.afterEach(() => {
  shopify.readVariantCost = original.read;
  shopify.pushVariantCost = original.push;
});

test.after(async () => {
  server.close();
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('Assignment line shows the Shopify purchase cost and keeps it on the line', async () => {
  shopify.readVariantCost = async (_creds, opts) => (opts.variantId === '111' ? 600 : null);
  const res = await api('GET', '/api/v1/orders/COST-1/sub-orders/COST-1-1/cost');
  assert.equal(res.status, 200);
  assert.deepEqual(
    { cost: res.body.data.cost, source: res.body.data.source, editable: res.body.data.editable },
    { cost: 600, source: 'shopify', editable: false },
  );
  const saved = await Order.findOne({ tenantId, orderNo: 'COST-1' }).setOptions({ skipTenantFilter: true });
  assert.equal(saved.subOrders[0].cost, 600);
  const blocked = await api('PUT', '/api/v1/orders/COST-1/sub-orders/COST-1-1/cost', { cost: 500 });
  assert.equal(blocked.status, 409);
});

test('blank Shopify cost can be filled on Assignment and is written to Shopify', async () => {
  const pushed = [];
  shopify.readVariantCost = async () => null;
  shopify.pushVariantCost = async (_creds, opts) => { pushed.push(opts); return { cost: opts.cost }; };
  const read = await api('GET', '/api/v1/orders/COST-2/sub-orders/COST-2-1/cost');
  assert.equal(read.status, 200);
  assert.equal(read.body.data.cost, null);
  assert.equal(read.body.data.editable, true);
  const bad = await api('PUT', '/api/v1/orders/COST-2/sub-orders/COST-2-1/cost', { cost: -5 });
  assert.equal(bad.status, 400);
  const res = await api('PUT', '/api/v1/orders/COST-2/sub-orders/COST-2-1/cost', { cost: '450' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.cost, 450);
  assert.equal(res.body.data.shopifyUpdated, true);
  assert.deepEqual(pushed.map((row) => [row.variantId, row.cost]), [['v-COST-2', 450]]);
  const saved = await Order.findOne({ tenantId, orderNo: 'COST-2' }).setOptions({ skipTenantFilter: true });
  assert.equal(saved.subOrders[0].cost, 450);
});

test('a line without a Shopify listing saves the cost in OMSKing only', async () => {
  shopify.readVariantCost = async () => { throw new Error('Shopify must not be called'); };
  shopify.pushVariantCost = async () => { throw new Error('Shopify must not be called'); };
  const read = await api('GET', '/api/v1/orders/COST-3/sub-orders/COST-3-1/cost');
  assert.equal(read.body.data.source, 'none');
  assert.equal(read.body.data.editable, true);
  const res = await api('PUT', '/api/v1/orders/COST-3/sub-orders/COST-3-1/cost', { cost: 300 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.cost, 300);
  assert.equal(res.body.data.shopifyUpdated, false);
});
