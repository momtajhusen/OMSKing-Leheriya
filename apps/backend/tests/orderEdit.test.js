process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const shopify = require('../src/adapters/shopify');
const { editOrder } = require('../src/services/orderEdit.service');
const Order = require('../src/models/Order');
const AuditLog = require('../src/models/AuditLog');

const PASSWORD = 'Password1';
const SHOP = { shopUrl: 'edit-test.myshopify.com', adminToken: 'shpat_test' };

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
  const ownerEmail = `edit-${label}-${Date.now()}@example.com`;
  const created = await provisionMerchant({ name: `Edit ${label}`, ownerEmail, ownerName: 'Owner', password: PASSWORD, status: 'active' });
  const res = await api('POST', '/api/v1/auth/login', { json: { email: ownerEmail, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { tenantId: created.tenant._id, token: res.body.data.accessToken };
}

function shopOrder(tenantId, orderNo, extra = {}) {
  return Order.create({
    tenantId,
    orderNo,
    channel: 'Shopify',
    source: 'channel_api',
    externalOrderId: '19033136136285',
    status: 'New',
    customer: 'Sudheera Sudheera',
    phone: '+919550134496',
    email: 'old@example.com',
    address: '201,A Block,Aperna One',
    city: 'Hyderabad 500008',
    shipState: 'Telangana',
    total: 3499,
    items: [{ name: 'Kota Doria', sku: 'LEH-HL21', qty: 1, price: 3499 }],
    subOrders: [{ id: `${orderNo}-1`, index: 1, sku: 'LEH-HL21', qty: 1, price: 3499, customer: 'Sudheera Sudheera', address: '201,A Block,Aperna One', status: 'New' }],
    ...extra,
  });
}

const CHANGES = {
  customer: 'Sudheera Reddy',
  phone: '+919000000001',
  email: 'new@example.com',
  address: 'Flat 5, Road 2, Banjara Hills',
  city: 'Hyderabad 500034',
  shipState: 'Telangana',
};

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

test('Shopify order edit sends the customer and shipping address through the mocked request only', async () => {
  const calls = [];
  const request = async (method, url, opts) => {
    calls.push({ method, url, body: opts.body });
    return { status: 200, text: JSON.stringify({ order: { id: 19033136136285 } }) };
  };
  await shopify.updateOrderAddress(SHOP, { orderId: '19033136136285', changes: CHANGES, request });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].url, 'https://edit-test.myshopify.com/admin/api/2024-10/orders/19033136136285.json');
  assert.deepEqual(calls[0].body, {
    order: {
      id: '19033136136285',
      email: 'new@example.com',
      shipping_address: {
        first_name: 'Sudheera',
        last_name: 'Reddy',
        address1: 'Flat 5, Road 2, Banjara Hills',
        address2: '',
        city: 'Hyderabad',
        zip: '500034',
        province: 'Telangana',
        phone: '+919000000001',
      },
    },
  });
  await assert.rejects(
    () => shopify.updateOrderAddress(SHOP, { orderId: '1', changes: CHANGES }),
    /Live API/,
  );
});

test('push to Shopify runs first and the OMS copy is saved only when Shopify accepts it', async () => {
  const { tenantId } = await merchant('svc');
  const order = await shopOrder(tenantId, 'SHP-SVC-1');
  const calls = [];
  const okRequest = async (method, url) => {
    calls.push({ method, url });
    return { status: 200, text: '{}' };
  };
  const pushed = await editOrder(tenantId, order, { ...CHANGES, pushToShopify: true }, { shopifyCreds: SHOP, shopifyRequest: okRequest });
  assert.equal(pushed.pushed, true);
  assert.equal(calls.length, 1);
  const saved = await Order.findById(order._id).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(saved.customer, 'Sudheera Reddy');
  assert.equal(saved.subOrders[0].address, 'Flat 5, Road 2, Banjara Hills');

  const other = await shopOrder(tenantId, 'SHP-SVC-2', { externalOrderId: '19033136136286' });
  const failRequest = async () => ({ status: 422, text: '{}' });
  await assert.rejects(
    () => editOrder(tenantId, other, { ...CHANGES, pushToShopify: true }, { shopifyCreds: SHOP, shopifyRequest: failRequest }),
    /Shopify/,
  );
  const untouched = await Order.findById(other._id).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(untouched.customer, 'Sudheera Sudheera');
});

test('PATCH /orders/:id keeps the edit in OMS only when push is off, and audits it', async () => {
  const { tenantId, token } = await merchant('api');
  await shopOrder(tenantId, 'SHP-API-1');
  const res = await api('PATCH', '/api/v1/orders/SHP-API-1', { token, json: { ...CHANGES, pushToShopify: false } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.customer, 'Sudheera Reddy');
  assert.equal(res.body.data.address, 'Flat 5, Road 2, Banjara Hills');
  assert.equal(res.body.data.city, 'Hyderabad 500034');
  assert.equal(res.body.data.email, 'new@example.com');
  assert.match(res.body.message, /not sent to Shopify/);
  const audit = await AuditLog.findOne({ tenantId, action: 'order.edited' }).setOptions({ skipTenantFilter: true }).lean();
  assert.ok(audit, 'edit is audited');
  assert.equal(audit.after.customer, 'Sudheera Reddy');
  assert.equal(audit.before.customer, 'Sudheera Sudheera');
});

test('PATCH /orders/:id refuses a Shopify push without Shopify set up and leaves the order unchanged', async () => {
  const { tenantId, token } = await merchant('nocreds');
  await shopOrder(tenantId, 'SHP-NC-1');
  const res = await api('PATCH', '/api/v1/orders/SHP-NC-1', { token, json: { ...CHANGES, pushToShopify: true } });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  const saved = await Order.findOne({ tenantId, orderNo: 'SHP-NC-1' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(saved.customer, 'Sudheera Sudheera');
});

test('PATCH /orders/:id refuses shipped, labelled, marketplace and other-tenant orders', async () => {
  const { tenantId, token } = await merchant('guard');
  await shopOrder(tenantId, 'SHP-G-1', { awb: 'AWB123' });
  await shopOrder(tenantId, 'SHP-G-2', { status: 'Dispatched', externalOrderId: '2' });
  await shopOrder(tenantId, 'AMZ-G-3', { channel: 'Amazon', externalOrderId: '3' });
  const labelled = await api('PATCH', '/api/v1/orders/SHP-G-1', { token, json: CHANGES });
  assert.equal(labelled.status, 400);
  const shipped = await api('PATCH', '/api/v1/orders/SHP-G-2', { token, json: CHANGES });
  assert.equal(shipped.status, 400);
  const amazon = await api('PATCH', '/api/v1/orders/AMZ-G-3', { token, json: { ...CHANGES, pushToShopify: false } });
  assert.equal(amazon.status, 400);
  await shopOrder(tenantId, 'SHP-G-4', { externalOrderId: '5' });
  const empty = await api('PATCH', '/api/v1/orders/SHP-G-4', { token, json: { ...CHANGES, customer: '  ' } });
  assert.equal(empty.status, 400);

  const other = await merchant('other');
  await shopOrder(other.tenantId, 'SHP-OTHER-1', { externalOrderId: '4' });
  const cross = await api('PATCH', '/api/v1/orders/SHP-OTHER-1', { token, json: CHANGES });
  assert.equal(cross.status, 404);
});
