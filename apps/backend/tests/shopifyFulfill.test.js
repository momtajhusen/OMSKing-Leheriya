process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const shopify = require('../src/adapters/shopify');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Shipment = require('../src/models/Shipment');
const { syncShopifyFulfillment } = require('../src/services/ship.service');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

const shopCreds = { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' };

test('restOrderId accepts numeric, gid, and SHP- ids', () => {
  assert.equal(shopify.restOrderId('6123456789'), '6123456789');
  assert.equal(shopify.restOrderId('gid://shopify/Order/6123456789'), '6123456789');
  assert.equal(shopify.restOrderId('SHP-6123456789'), '6123456789');
  assert.equal(shopify.restOrderId('#6123456789'), '6123456789');
});

test('fulfillOrder releases on_hold then creates fulfillment with tracking', async () => {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes('/fulfillment_orders.json') && !url.includes('release_hold')) {
      const held = calls.filter((c) => c.url.includes('release_hold')).length === 0;
      return {
        status: 200,
        text: JSON.stringify({
          fulfillment_orders: [{
            id: 77,
            status: held ? 'on_hold' : 'open',
          }],
        }),
      };
    }
    if (url.includes('/release_hold.json')) return { status: 200, text: '{}' };
    if (url.endsWith('/fulfillments.json')) {
      return { status: 200, text: JSON.stringify({ fulfillment: { id: 88 } }) };
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const result = await shopify.fulfillOrder(shopCreds, {
    orderId: 'gid://shopify/Order/9001',
    trackingNumber: 'AWB-1',
    company: 'Delhivery',
    request,
  });
  assert.equal(result.fulfillmentId, '88');
  assert.ok(calls.some((c) => c.url.includes('/orders/9001/fulfillment_orders.json')));
  assert.ok(calls.some((c) => c.url.includes('/fulfillment_orders/77/release_hold.json')));
  const create = calls.find((c) => c.url.endsWith('/fulfillments.json'));
  assert.equal(create.body.fulfillment.tracking_info.number, 'AWB-1');
});

test('fulfillOrder updates tracking when Shopify is already fulfilled (closed FO)', async () => {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes('/fulfillment_orders.json')) {
      return { status: 200, text: JSON.stringify({ fulfillment_orders: [{ id: 1, status: 'closed' }] }) };
    }
    if (url.endsWith('/fulfillments.json') && method === 'GET') {
      return { status: 200, text: JSON.stringify({ fulfillments: [{ id: 55, status: 'success' }] }) };
    }
    if (url.includes('/update_tracking.json')) {
      return { status: 200, text: JSON.stringify({ fulfillment: { id: 55 } }) };
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const result = await shopify.fulfillOrder(shopCreds, {
    orderId: '9001',
    trackingNumber: 'AWB-NEW',
    company: 'Delhivery',
    request,
  });
  assert.equal(result.fulfillmentId, '55');
  assert.ok(calls.some((c) => c.url.includes('/update_tracking.json')));
  assert.equal(calls.find((c) => c.url.includes('/update_tracking.json')).body.fulfillment.tracking_info.number, 'AWB-NEW');
});

test('cancelOrderFulfillments cancels by lookup when fulfillment id was not stored', async () => {
  const canceled = [];
  const request = async (method, url) => {
    if (url.endsWith('/fulfillments.json') && method === 'GET') {
      return {
        status: 200,
        text: JSON.stringify({ fulfillments: [{ id: 71, status: 'success' }, { id: 72, status: 'cancelled' }] }),
      };
    }
    if (url.includes('/fulfillments/') && url.includes('/cancel.json')) {
      const id = url.match(/fulfillments\/(\d+)/)?.[1];
      canceled.push(id);
      return { status: 200, text: '{}' };
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const result = await shopify.cancelOrderFulfillments(shopCreds, { orderId: 'SHP-9001', request });
  assert.deepEqual(result.canceled, ['71']);
  assert.deepEqual(canceled, ['71']);
});

test('syncShopifyFulfillment stamps shipment when Dispatched retries fulfill', async () => {
  const tenant = await Tenant.create({
    name: 'Fulfill Shop',
    slug: `ful-${Date.now()}`,
    kind: 'merchant',
  });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-9001',
    channel: 'Shopify',
    status: 'Dispatched',
    awb: 'AWB-RETRY',
    courier: 'Delhivery',
    externalOrderId: '9001',
    items: [{ name: 'Saree', sku: 'S1', qty: 1, price: 100 }],
  });
  await Shipment.create({
    tenantId: tenant._id,
    orderNo: 'SHP-9001',
    channel: 'shopify',
    courier: 'delhivery',
    awb: 'AWB-RETRY',
    status: 'booked',
    warehouseCode: 'WH-001',
    bookedAt: new Date(),
  });
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-9001' });
  const request = async (method, url) => {
    if (url.includes('fulfillment_orders')) {
      return { status: 200, text: JSON.stringify({ fulfillment_orders: [{ id: 11, status: 'open' }] }) };
    }
    if (url.endsWith('/fulfillments.json')) {
      return { status: 200, text: JSON.stringify({ fulfillment: { id: 55 } }) };
    }
    throw new Error(`unexpected ${url}`);
  };
  await syncShopifyFulfillment(tenant._id, order, { shopifyCreds: shopCreds, shopifyRequest: request });
  const shipment = await Shipment.findOne({ tenantId: tenant._id, orderNo: 'SHP-9001', status: 'booked' });
  assert.equal(shipment.shopifyFulfillmentId, '55');
});
