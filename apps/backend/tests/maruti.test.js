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
  orderType: 'FORWARD',
  parcelCategory: 'ECOMM',
};
const shopCreds = { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' };

function marutiMock({ bookStatus = 200, trackStatus = 'Delivered' } = {}) {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    const body = typeof opts.body === 'string' && opts.body.startsWith('{')
      ? JSON.parse(opts.body)
      : (opts.body && typeof opts.body === 'object' ? opts.body : opts.body);
    calls.push({ method, url, headers: opts.headers || {}, body });
    if (url.includes('/gateway/booking-service/orders/cancel/bulk')) {
      return { status: 200, text: JSON.stringify({ data: { cancelledCount: 1 } }) };
    }
    if (url.endsWith('/gateway/booking-service/orders') && method === 'POST') {
      if (bookStatus !== 200) {
        return { status: bookStatus, text: JSON.stringify({ message: 'Pincode not serviceable' }) };
      }
      return {
        status: 200,
        text: JSON.stringify({
          data: {
            orderId: 'IF-9001',
            shipments: [{ awbNumber: 'SM123456789' }],
          },
        }),
      };
    }
    if (url.endsWith('/gateway/pdf-generator/shipping-label') && method === 'POST') {
      return {
        status: 200,
        text: JSON.stringify({
          status: 'success',
          data: { shippingLabelUrl: 'https://innofulfill-prod-files.s3.ap-south-1.amazonaws.com/test-label.pdf' },
        }),
      };
    }
    if (url.includes('innofulfill-prod-files.s3') && method === 'GET') {
      return { status: 200, text: PDF.toString('binary'), buffer: PDF, headers: { 'content-type': 'application/pdf' } };
    }
    if (url.includes('/gateway/tracking-v2/api/tracking/awb/')) {
      return {
        status: 200,
        text: JSON.stringify({
          data: {
            status: trackStatus,
            statuses: [
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

test('Shree Maruti books via gateway with api-key auth and returns AWB with label PDF', async () => {
  const mock = marutiMock();
  const booked = await maruti.book(creds, parcel, { request: mock.request });
  assert.equal(booked.awb, 'SM123456789');
  assert.equal(booked.shipmentId, 'IF-9001');
  assert.ok(Buffer.isBuffer(booked.labelPdf));
  assert.equal(booked.labelPdf.toString(), PDF.toString());
  const create = mock.calls.find((call) => call.url.endsWith('/gateway/booking-service/orders'));
  assert.equal(create.url, 'https://apis.innofulfill.com/gateway/booking-service/orders');
  assert.equal(create.headers['api-key'], 'innofulfill_test_key');
  assert.equal(create.headers.tenantid, 'tenant-1');
  assert.equal(create.body.parcelCategory, 'ECOMM');
  assert.equal(create.body.addresses.find((row) => row.type === 'DELIVERY').zip, '302001');
  assert.equal(create.body.referenceId, 'SHP-SM');
  assert.ok(mock.calls.some((call) => call.url.endsWith('/gateway/pdf-generator/shipping-label')));
});

test('Shree Maruti asks for COD amount on COD parcels', async () => {
  const mock = marutiMock();
  await maruti.book(creds, { ...parcel, paymentMode: 'COD', codAmount: 1299 }, { request: mock.request });
  const create = mock.calls.find((call) => call.url.endsWith('/gateway/booking-service/orders'));
  assert.equal(create.body.payment.type, 'COD');
  assert.equal(create.body.amount, 1299);
});

test('Shree Maruti is never called without API environment or Innofulfill credentials', async () => {
  await assert.rejects(() => maruti.book({ ...creds, apiMode: '' }, parcel), /live or sandbox/);
  const mock = marutiMock();
  await assert.rejects(() => maruti.book(creds, { ...parcel, weightGrams: 0 }, { request: mock.request }), /weight and size/);
  await assert.rejects(() => maruti.book({ ...creds, apiKey: '' }, parcel, { request: mock.request }), /API key/);
  assert.equal(mock.calls.length, 0);
});

test('Shree Maruti cancel and tracking call the official gateway endpoints', async () => {
  const mock = marutiMock();
  await maruti.cancel(creds, { awb: 'SM123456789', shipmentId: 'IF-9001' }, { request: mock.request });
  const cancel = mock.calls.find((call) => call.url.endsWith('/orders/cancel/bulk'));
  assert.equal(cancel.method, 'POST');
  assert.equal(cancel.body.orders[0].orderId, 'IF-9001');
  const tracked = await maruti.track(creds, 'SM123456789', { request: mock.request });
  assert.match(mock.calls.at(-1).url, /\/gateway\/tracking-v2\/api\/tracking\/awb\/SM123456789$/);
  assert.deepEqual(tracked.events.map((row) => row.status), ['picked_up', 'in_transit', 'delivered']);
});

test('Shree Maruti tracking codes map to OMSKing scan statuses', () => {
  assert.equal(maruti.mapScanStatus('Picked Up'), 'picked_up');
  assert.equal(maruti.mapScanStatus('Out for Delivery'), 'out_for_delivery');
  assert.equal(maruti.mapScanStatus('OUT_FOR_DELIVERY'), 'out_for_delivery');
  assert.equal(maruti.mapScanStatus('Delivered'), 'delivered');
  assert.equal(maruti.mapScanStatus('DELIVERED'), 'delivered');
  assert.equal(maruti.mapScanStatus('IN_TRANSIT'), 'in_transit');
  assert.equal(maruti.mapScanStatus('PICKED_UP'), 'picked_up');
  assert.equal(maruti.mapScanStatus('RTO Initiated'), 'rto');
  assert.equal(maruti.mapScanStatus('Unknown'), '');
});

test('Shree Maruti track reads top-level statuses beside orderInformation (live Innofulfill shape)', async () => {
  const calls = [];
  const request = async (method, url) => {
    calls.push({ method, url });
    assert.match(url, /\/gateway\/tracking-v2\/api\/tracking\/awb\/PRDO0000000002$/);
    return {
      status: 200,
      text: JSON.stringify({
        orderInformation: {
          trackingId: 'PRDO0000000002',
          currentShipmentPhase: 'delivered',
        },
        statuses: [
          { status: 'PICKED_UP', event: 'picked_up', statusTimestamp: 1, createdAt: 't1' },
          { status: 'IN_TRANSIT', event: 'inscanned_at_transit', statusTimestamp: 2, createdAt: 't2' },
          { status: 'OUT_FOR_DELIVERY', event: 'out_for_delivery', statusTimestamp: 3, createdAt: 't3' },
          { status: 'DELIVERED', event: 'delivered', category: 'DELIVERED', statusTimestamp: 4, createdAt: 't4' },
        ],
      }),
    };
  };
  const tracked = await maruti.track(creds, 'PRDO0000000002', { request });
  assert.equal(tracked.status, 'delivered');
  assert.deepEqual(tracked.events.map((row) => row.status), [
    'picked_up', 'in_transit', 'out_for_delivery', 'delivered',
  ]);
  assert.equal(calls.length, 1);
});

test('Shree Maruti pickup replaces WH-001 Fashion Street placeholder with company legal address', async () => {
  const tenant = await Tenant.create({
    name: 'Leheriya Co',
    slug: `sm-legal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: 'merchant',
    legalEntity: {
      legalName: 'PRDOSCO GLOBAL PRIVATE LIMITED',
      address: 'BASEMENT, PLOT NO. 24, SECTOR 12-A ROAD, SECTOR 12, DWARKA',
      city: 'NEW DELHI',
      district: 'NEW DELHI - 110078',
      phone: '+91 98730 03388',
    },
  });
  await CourierAccount.create({
    tenantId: tenant._id, source: 'own', code: 'shree-maruti', name: 'Shree Maruti', status: 'active',
    credentialsEnc: encryptObject(creds),
  });
  await Warehouse.create({
    tenantId: tenant._id, code: 'WH-001', name: 'Physical / Offline', type: 'physical', isPickup: true, status: 'active',
    contactPhone: '+919876543210',
    address: { line1: '123 Fashion Street', city: 'Delhi', state: 'Delhi', pincode: '110078' },
  });
  await Order.create({
    tenantId: tenant._id, orderNo: 'SHP-SM-LEGAL', channel: 'Shopify', status: 'New', source: 'manual',
    customer: 'Asha', address: '12 MG Road 302001', city: 'Jaipur 302001', phone: '9111111111',
    paymentMode: 'Prepaid', total: 1299, externalOrderId: '9109',
    items: [{ sku: 'K1', name: 'Kurta', qty: 1, price: 1299, pack: { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 4 } }],
  });
  const mock = marutiMock();
  const shopify = shopifyMock();
  await bookOtherCourier(tenant._id, 'SHP-SM-LEGAL', { courier: 'shree-maruti' }, {
    marutiCreds: creds,
    marutiRequest: mock.request,
    shopifyCreds: shopCreds,
    shopifyRequest: shopify.request,
  });
  const create = mock.calls.find((call) => call.url.endsWith('/gateway/booking-service/orders'));
  const pickup = (create.body.addresses || []).find((row) => row.type === 'PICKUP');
  assert.match(String(pickup.street || pickup.addressName || ''), /PLOT NO\. 24|DWARKA/i);
  assert.doesNotMatch(String(pickup.street || ''), /Fashion Street/i);
  assert.match(String(pickup.name || ''), /PRDOSCO/i);
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

test('a failed Shopify fulfil after Shree Maruti booked keeps the AWB and resumes without a second AWB', async () => {
  const tenant = await seller();
  await CourierAccount.create({
    tenantId: tenant._id, source: 'own', code: 'shree-maruti', name: 'Shree Maruti', status: 'active',
    credentialsEnc: encryptObject(creds),
  });
  await shopifyOrder(tenant._id, 'SHP-SM-RETRY');
  const mock = marutiMock();
  let fulfillAttempts = 0;
  const shopifyRequest = async (method, url) => {
    if (url.includes('fulfillment_orders')) return { status: 200, text: JSON.stringify({ fulfillment_orders: [{ id: 77, status: 'open' }] }) };
    if (url.endsWith('/fulfillments.json')) {
      fulfillAttempts += 1;
      if (fulfillAttempts === 1) {
        const err = new Error('Shopify down');
        err.statusCode = 502;
        throw err;
      }
      return { status: 200, text: JSON.stringify({ fulfillment: { id: 99 } }) };
    }
    throw new Error(`unexpected Shopify call ${url}`);
  };
  await assert.rejects(
    () => bookOtherCourier(tenant._id, 'SHP-SM-RETRY', { courier: 'shree-maruti' }, {
      marutiCreds: creds, marutiRequest: mock.request, shopifyCreds: shopCreds, shopifyRequest,
    }),
    /Shopify down/,
  );
  assert.equal(mock.calls.filter((call) => call.url.endsWith('/gateway/booking-service/orders')).length, 1);
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-SM-RETRY' });
  assert.equal(order.awb, 'SM123456789');
  const shipment = await bookOtherCourier(tenant._id, 'SHP-SM-RETRY', { courier: 'shree-maruti' }, {
    marutiCreds: creds, marutiRequest: mock.request, shopifyCreds: shopCreds, shopifyRequest,
  });
  assert.equal(shipment.awb, 'SM123456789');
  assert.equal(shipment.shopifyFulfillmentId, '99');
  assert.equal(mock.calls.filter((call) => call.url.endsWith('/gateway/booking-service/orders')).length, 1);
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
  assert.ok(mock.calls.some((call) => call.url.endsWith('/orders/cancel/bulk')));
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
  assert.ok(mock.calls.some((call) => call.url.includes('/gateway/tracking-v2/api/tracking/awb/')));
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-SM-TRK' });
  assert.equal(order.status, 'Delivered');
});
