process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Warehouse = require('../src/models/Warehouse');
const Shipment = require('../src/models/Shipment');
const CourierAccount = require('../src/models/CourierAccount');
const maruti = require('../src/adapters/couriers/maruti');
const {
  bookOtherCourier,
  cancelShopifyLabel,
  shippingReadiness,
  courierLabelPdf,
} = require('../src/services/ship.service');
const { pollOpenShipments } = require('../src/services/tracking.service');
const { encryptObject } = require('../src/lib/secretBox');

let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

const PDF = Buffer.from('%PDF-1.4 maruti label');
const creds = {
  apiMode: 'sandbox',
  email: 'ops@example.com',
  password: 'test-password',
  apiKey: 'innofulfill_test_key',
  userId: 'user-1',
  accountTenantId: 'tenant-1',
  orderType: 'Forward',
  parcelCategory: 'Ecomm',
};
const shopCreds = { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' };

function marutiMock({ bookStatus = 200, trackStatus = 'Delivered' } = {}) {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    const body = typeof opts.body === 'string' && opts.body.startsWith('{')
      ? JSON.parse(opts.body)
      : (opts.body && typeof opts.body === 'object' ? opts.body : opts.body);
    calls.push({ method, url, headers: opts.headers || {}, body });
    if (url.endsWith('/api/v1/auth/login')) {
      assert.equal(method, 'POST');
      assert.equal(body.email, 'ops@example.com');
      assert.equal(body.api_key, 'innofulfill_test_key');
      return { status: 200, text: JSON.stringify({ token: 'maruti-jwt' }) };
    }
    if (url.endsWith('/api/v1/orders') && method === 'POST') {
      if (bookStatus !== 200) {
        return { status: bookStatus, text: JSON.stringify({ message: 'Pincode not serviceable' }) };
      }
      return {
        status: 200,
        text: JSON.stringify({
          data: {
            awb: 'SM123456789',
            order_id: 'IF-9001',
            label_base64: PDF.toString('base64'),
          },
        }),
      };
    }
    if (url.endsWith('/api/v1/orders/cancel')) {
      return { status: 200, text: JSON.stringify({ data: { cancelled: true } }) };
    }
    if (url.includes('/api/v1/tracking/')) {
      return {
        status: 200,
        text: JSON.stringify({
          data: {
            status: trackStatus,
            scans: [
              { status: 'Picked Up', time: 't1' },
              { status: 'In Transit', time: 't2' },
              { status: trackStatus, time: 't3' },
            ],
          },
        }),
      };
    }
    throw new Error(`unexpected Maruti call ${method} ${url}`);
  };
  return { calls, request };
}

function shopifyMock() {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes('fulfillment_orders')) return { status: 200, text: JSON.stringify({ fulfillment_orders: [{ id: 77 }] }) };
    if (url.endsWith('/fulfillments.json')) return { status: 200, text: JSON.stringify({ fulfillment: { id: 88 } }) };
    if (url.includes('/cancel.json')) return { status: 200, text: '{}' };
    throw new Error(`unexpected Shopify call ${url}`);
  };
  return { calls, request };
}

const parcel = {
  name: 'Asha',
  address: '12 MG Road',
  city: 'Jaipur',
  state: 'Rajasthan',
  pincode: '302001',
  phone: '9111111111',
  orderNo: 'SHP-SM',
  paymentMode: 'Prepaid',
  amount: 1299,
  codAmount: 0,
  description: 'Kurta',
  quantity: 1,
  weightGrams: 500,
  lengthCm: 30,
  breadthCm: 25,
  heightCm: 4,
  pickup: { name: 'Leheriya', line1: 'Workshop lane', city: 'Jaipur', state: 'Rajasthan', pincode: '302002', phone: '9000000000' },
};

async function seller() {
  return Tenant.create({ name: 'SM Seller', slug: `sm-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: 'merchant' });
}

async function shopifyOrder(tenantId, orderNo) {
  await Warehouse.create({
    tenantId, code: 'WH-001', name: 'Main', type: 'physical', isPickup: true, status: 'active',
    contactPhone: '9000000000',
    address: { line1: 'Workshop lane', city: 'Jaipur', state: 'Rajasthan', pincode: '302002' },
  });
  return Order.create({
    tenantId, orderNo, channel: 'Shopify', status: 'New', source: 'manual',
    customer: 'Asha', address: '12 MG Road 302001', city: 'Jaipur 302001', phone: '9111111111',
    paymentMode: 'Prepaid', total: 1299, externalOrderId: '9101',
    items: [{ sku: 'K1', name: 'Kurta', qty: 1, price: 1299, pack: { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 4 } }],
  });
}

test('Shree Maruti book logs in, creates an order, and returns AWB with label PDF', async () => {
  const mock = marutiMock();
  const booked = await maruti.book(creds, parcel, { request: mock.request });
  assert.equal(booked.awb, 'SM123456789');
  assert.equal(booked.shipmentId, 'IF-9001');
  assert.ok(Buffer.isBuffer(booked.labelPdf));
  assert.equal(booked.labelPdf.toString(), PDF.toString());
  const [login, create] = mock.calls;
  assert.equal(login.url, 'https://api.innofulfill.com/api/v1/auth/login');
  assert.equal(create.headers.Authorization, 'Bearer maruti-jwt');
  assert.equal(create.headers['x-api-key'], 'innofulfill_test_key');
  assert.equal(create.headers['x-tenant-id'], 'tenant-1');
  assert.equal(create.body.consignee.pincode, '302001');
  assert.equal(create.body.order_id, 'SHP-SM');
});

test('Shree Maruti asks for COD amount on COD parcels', async () => {
  const mock = marutiMock();
  await maruti.book(creds, { ...parcel, paymentMode: 'COD', codAmount: 1299 }, { request: mock.request });
  assert.equal(mock.calls[1].body.payment_mode, 'COD');
  assert.equal(mock.calls[1].body.cod_amount, 1299);
});

test('Shree Maruti is never called without API environment or Innofulfill credentials', async () => {
  await assert.rejects(() => maruti.book({ ...creds, apiMode: '' }, parcel), /live or sandbox/);
  const mock = marutiMock();
  await assert.rejects(() => maruti.book(creds, { ...parcel, weightGrams: 0 }, { request: mock.request }), /weight and size/);
  await assert.rejects(() => maruti.book({ ...creds, apiKey: '' }, parcel, { request: mock.request }), /API key/);
  assert.equal(mock.calls.length, 0);
});

test('Shree Maruti cancel and tracking call the Innofulfill endpoints', async () => {
  const mock = marutiMock();
  await maruti.cancel(creds, { awb: 'SM123456789', shipmentId: 'IF-9001' }, { request: mock.request });
  const cancel = mock.calls.find((call) => call.url.endsWith('/orders/cancel'));
  assert.equal(cancel.method, 'POST');
  assert.equal(cancel.body.awb, 'SM123456789');
  const tracked = await maruti.track(creds, 'SM123456789', { request: mock.request });
  assert.match(mock.calls.at(-1).url, /\/api\/v1\/tracking\/SM123456789$/);
  assert.deepEqual(tracked.events.map((row) => row.status), ['picked_up', 'in_transit', 'delivered']);
});

test('Shree Maruti tracking codes map to OMSKing scan statuses', () => {
  assert.equal(maruti.mapScanStatus('Picked Up'), 'picked_up');
  assert.equal(maruti.mapScanStatus('Out for Delivery'), 'out_for_delivery');
  assert.equal(maruti.mapScanStatus('Delivered'), 'delivered');
  assert.equal(maruti.mapScanStatus('RTO Initiated'), 'rto');
  assert.equal(maruti.mapScanStatus('Unknown'), '');
});

test('booking a Shopify order on Shree Maruti needs no typed AWB, stores the label and fulfils Shopify', async () => {
  const tenant = await seller();
  await CourierAccount.create({
    tenantId: tenant._id, source: 'own', code: 'shree-maruti', name: 'Shree Maruti', status: 'active',
    credentialsEnc: encryptObject(creds),
  });
  await shopifyOrder(tenant._id, 'SHP-SM-API');
  const mock = marutiMock();
  const shopify = shopifyMock();
  const shipment = await bookOtherCourier(tenant._id, 'SHP-SM-API', { courier: 'shree-maruti' }, {
    marutiCreds: creds,
    marutiRequest: mock.request,
    shopifyCreds: shopCreds,
    shopifyRequest: shopify.request,
  });
  assert.equal(shipment.courier, 'shree-maruti');
  assert.equal(shipment.awb, 'SM123456789');
  assert.equal(shipment.labelPdf.toString(), PDF.toString());
  assert.equal(shipment.shopifyFulfillmentId, '88');
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-SM-API' });
  assert.equal(order.courier, 'Shree Maruti');
  assert.equal(order.awb, 'SM123456789');
  assert.equal(order.status, 'Dispatched');
  assert.equal((await courierLabelPdf(tenant._id, 'SHP-SM-API')).toString(), PDF.toString());
  const readiness = await shippingReadiness(tenant._id);
  assert.equal(readiness.couriers.find((row) => row.code === 'shree-maruti')?.api, true);
});

test('a failed Shopify fulfil after Shree Maruti booked resumes without creating a second AWB', async () => {
  const tenant = await seller();
  await CourierAccount.create({
    tenantId: tenant._id, source: 'own', code: 'shree-maruti', name: 'Shree Maruti', status: 'active',
    credentialsEnc: encryptObject(creds),
  });
  await shopifyOrder(tenant._id, 'SHP-SM-RETRY');
  const mock = marutiMock();
  let shopCalls = 0;
  const shopifyRequest = async (method, url) => {
    shopCalls += 1;
    if (url.includes('fulfillment_orders')) return { status: 200, text: JSON.stringify({ fulfillment_orders: [{ id: 77 }] }) };
    if (url.endsWith('/fulfillments.json') && shopCalls < 4) {
      const err = new Error('Shopify down');
      err.statusCode = 502;
      throw err;
    }
    if (url.endsWith('/fulfillments.json')) return { status: 200, text: JSON.stringify({ fulfillment: { id: 99 } }) };
    throw new Error(`unexpected Shopify call ${url}`);
  };
  await assert.rejects(() => bookOtherCourier(tenant._id, 'SHP-SM-RETRY', { courier: 'shree-maruti' }, {
    marutiCreds: creds, marutiRequest: mock.request, shopifyCreds: shopCreds, shopifyRequest,
  }), /Shopify down/);
  assert.equal(mock.calls.filter((call) => call.url.endsWith('/api/v1/orders')).length, 1);
  const shipment = await bookOtherCourier(tenant._id, 'SHP-SM-RETRY', { courier: 'shree-maruti' }, {
    marutiCreds: creds, marutiRequest: mock.request, shopifyCreds: shopCreds, shopifyRequest,
  });
  assert.equal(shipment.awb, 'SM123456789');
  assert.equal(shipment.shopifyFulfillmentId, '99');
  assert.equal(mock.calls.filter((call) => call.url.endsWith('/api/v1/orders')).length, 1);
});

test('cancelling a Shree Maruti label calls cancel and clears the order AWB', async () => {
  const tenant = await seller();
  await CourierAccount.create({
    tenantId: tenant._id, source: 'own', code: 'shree-maruti', name: 'Shree Maruti', status: 'active',
    credentialsEnc: encryptObject(creds),
  });
  await shopifyOrder(tenant._id, 'SHP-SM-CXL');
  const mock = marutiMock();
  const shopify = shopifyMock();
  await bookOtherCourier(tenant._id, 'SHP-SM-CXL', { courier: 'shree-maruti' }, {
    marutiCreds: creds, marutiRequest: mock.request, shopifyCreds: shopCreds, shopifyRequest: shopify.request,
  });
  await cancelShopifyLabel(tenant._id, 'SHP-SM-CXL', {
    deps: { marutiCreds: creds, marutiRequest: mock.request, shopifyCreds: shopCreds, shopifyRequest: shopify.request },
  });
  assert.ok(mock.calls.some((call) => call.url.endsWith('/orders/cancel')));
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-SM-CXL' });
  assert.equal(order.awb, '');
  assert.equal(order.status, 'New');
});

test('open-shipment tracking matches Shree Maruti by display name and code', async () => {
  const tenant = await seller();
  await Order.create({
    tenantId: tenant._id, orderNo: 'SHP-SM-TRK', channel: 'Shopify', status: 'Dispatched',
    courier: 'Shree Maruti', awb: 'SM777', source: 'manual',
  });
  await Shipment.create({
    tenantId: tenant._id, orderNo: 'SHP-SM-TRK', channel: 'shopify', courier: 'shree-maruti',
    awb: 'SM777', status: 'booked', bookedAt: new Date(),
  });
  const mock = marutiMock();
  const result = await pollOpenShipments(tenant._id, {
    marutiCreds: creds,
    marutiRequest: mock.request,
    delhiveryCreds: {},
  });
  assert.equal(result.checked, 1);
  assert.ok(mock.calls.some((call) => call.url.includes('/api/v1/tracking/')));
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-SM-TRK' });
  assert.equal(order.status, 'Delivered');
});
