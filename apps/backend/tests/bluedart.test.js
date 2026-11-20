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
const bluedart = require('../src/adapters/couriers/bluedart');
const { hasCourierSecret } = require('../src/constants/courierCatalog');
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

const PDF = Buffer.from('%PDF-1.4 bluedart label');
const creds = {
  apiMode: 'sandbox',
  clientId: 'bd-client',
  clientSecret: 'bd-secret',
  loginId: 'DEL79448',
  licenceKey: 'licence-secret',
  trackingLicenceKey: 'tracking-secret',
  customerCode: '871102',
  customerCodeCod: '871102',
  vendorCode: '871102',
  originArea: 'DEL',
  serviceType: 'Air/Apex',
  accountMode: 'sandbox',
};
const shopCreds = { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' };

function blueMock({ bookStatus = 200, cancelStatus = 200, trackStatus = 'SHIPMENT DELIVERED' } = {}) {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    const body = typeof opts.body === 'string' && opts.body.startsWith('{') ? JSON.parse(opts.body) : opts.body;
    calls.push({ method, url, headers: opts.headers || {}, body });
    if (url.endsWith('/token/v1/login')) {
      assert.equal(method, 'GET');
      assert.equal(opts.headers.clientID || opts.headers.ClientID, 'bd-client');
      assert.equal(opts.headers.clientSecret, 'bd-secret');
      assert.equal(Boolean(new URL(url).search), false, 'login must not put secrets in the query string');
      return { status: 200, text: JSON.stringify({ JWTToken: 'jwt-test-token' }) };
    }
    if (url.endsWith('/waybill/v1/GenerateWayBill')) {
      if (bookStatus !== 200) {
        return { status: bookStatus, text: JSON.stringify({ title: 'Bad Request', 'error-response': [{ msg: 'Invalid pincode' }] }) };
      }
      return {
        status: 200,
        text: JSON.stringify({
          GenerateWayBillResult: {
            IsError: false,
            AWBNo: 'BD89186876973',
            AWBPrintContent: PDF.toString('base64'),
          },
        }),
      };
    }
    if (url.endsWith('/waybill/v1/CancelWaybill')) {
      return { status: cancelStatus, text: cancelStatus === 200 ? '{}' : JSON.stringify({ title: 'Cannot cancel' }) };
    }
    if (url.includes('/tracking/v1/shipment')) {
      return {
        status: 200,
        text: JSON.stringify({
          ShipmentData: {
            Shipment: [{
              Status: trackStatus,
              Scans: [
                { ScanDetail: { Scan: 'Shipment Picked Up', ScanDate: '16-Nov-2026', ScanTime: '10:00' } },
                { ScanDetail: { Scan: 'In Transit', ScanDate: '16-Nov-2026', ScanTime: '14:00' } },
                { ScanDetail: { Scan: trackStatus, ScanDate: '17-Nov-2026', ScanTime: '11:00' } },
              ],
            }],
          },
        }),
      };
    }
    throw new Error(`unexpected Blue Dart call ${method} ${url}`);
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
  orderNo: 'SHP-BD',
  paymentMode: 'Prepaid',
  amount: 2299,
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
  return Tenant.create({ name: 'BD Seller', slug: `bd-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: 'merchant' });
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
    paymentMode: 'Prepaid', total: 2299, externalOrderId: '9001',
    items: [{ sku: 'K1', name: 'Kurta', qty: 1, price: 2299, pack: { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 4 } }],
  });
}

test('hasCourierSecret treats Blue Dart licenceKey as ready, not only apiToken', () => {
  assert.equal(hasCourierSecret({ licenceKey: 'x' }), true);
  assert.equal(hasCourierSecret({ apiToken: 't' }), true);
  assert.equal(hasCourierSecret({ loginId: 'DEL79448' }), false);
});

test('Shipway-only Blue Dart credentials keep API booking off until Apigee Client ID is set', async () => {
  const tenant = await seller();
  await CourierAccount.create({
    tenantId: tenant._id, source: 'own', code: 'bluedart', name: 'Bluedart', status: 'active',
    credentialsEnc: encryptObject({
      apiMode: 'live',
      loginId: 'DEL79448',
      licenceKey: 'licence-only',
      customerCode: '871102',
    }),
  });
  const readiness = await shippingReadiness(tenant._id);
  assert.equal(readiness.couriers.find((row) => row.code === 'bluedart')?.api, false);
});

test('Blue Dart book logs in, generates a waybill, and returns AWB with label PDF', async () => {
  const blue = blueMock();
  const booked = await bluedart.book(creds, parcel, { request: blue.request });
  assert.equal(booked.awb, 'BD89186876973');
  assert.ok(Buffer.isBuffer(booked.labelPdf));
  assert.equal(booked.labelPdf.toString(), PDF.toString());
  const [login, waybill] = blue.calls;
  assert.equal(login.method, 'GET');
  assert.equal(login.url, 'https://apigateway-sandbox.bluedart.com/in/transportation/token/v1/login');
  assert.equal(login.headers.clientID, 'bd-client');
  assert.equal(login.headers.clientSecret, 'bd-secret');
  assert.equal(waybill.url, 'https://apigateway-sandbox.bluedart.com/in/transportation/waybill/v1/GenerateWayBill');
  assert.equal(waybill.headers.JWTToken, 'jwt-test-token');
  assert.equal(waybill.headers.Type, 'S');
  assert.equal(waybill.headers.clientid, 'bd-client');
  assert.equal(waybill.body.Profile.LoginID, 'DEL79448');
  assert.equal(waybill.body.Profile.Api_type, 'S');
  assert.equal(waybill.body.Request.Services.CreditReferenceNo, 'SHP-BD');
  assert.equal(waybill.body.Request.Consignee.ConsigneePincode, '302001');
  assert.equal(waybill.body.Request.Shipper.CustomerPincode, '302002');
  assert.ok(Array.isArray(waybill.body.Request.Services.Dimensions));
  assert.equal(waybill.body.Request.Services.Dimensions[0].Length, 30);
  assert.equal(waybill.body.Request.Services.PickupTime.length, 4);
  assert.equal(waybill.body.Request.Services.RegisterPickup, true);
});

test('Blue Dart asks for COD collectable amount on COD parcels', async () => {
  const blue = blueMock();
  await bluedart.book(creds, { ...parcel, paymentMode: 'COD', codAmount: 2299 }, { request: blue.request });
  assert.equal(blue.calls[1].body.Request.Services.CollectableAmount, 2299);
  assert.equal(blue.calls[1].body.Request.Services.SubProductCode, 'C');
});

test('Blue Dart bookReturn sets IsReversePickup and SubProductCode P', async () => {
  const blue = blueMock();
  const booked = await bluedart.bookReturn(creds, parcel, { request: blue.request });
  assert.equal(booked.awb, 'BD89186876973');
  assert.equal(booked.paymentMode, 'Pickup');
  const waybill = blue.calls[1];
  assert.equal(waybill.body.Request.Services.IsReversePickup, true);
  assert.equal(waybill.body.Request.Services.SubProductCode, 'P');
  assert.equal(waybill.body.Request.Services.CollectableAmount, 0);
  assert.equal(waybill.body.Request.Shipper.VendorCode, undefined);
  assert.equal(waybill.body.Request.Returnadds.ReturnPincode, '302002');
  assert.equal(waybill.body.Request.Consignee.ConsigneePincode, '302001');
});

test('Blue Dart is never called without API environment, package size, or gateway credentials', async () => {
  await assert.rejects(() => bluedart.book({ ...creds, apiMode: '', accountMode: '' }, parcel), /live or sandbox/);
  const blue = blueMock();
  await assert.rejects(() => bluedart.book(creds, { ...parcel, weightGrams: 0 }, { request: blue.request }), /weight and size/);
  await assert.rejects(() => bluedart.book({ ...creds, clientSecret: '' }, parcel, { request: blue.request }), /Client secret/);
  assert.equal(blue.calls.length, 0);
});

test('Blue Dart cancel and tracking call the gateway endpoints', async () => {
  const blue = blueMock();
  await bluedart.cancel(creds, 'BD89186876973', { request: blue.request });
  const cancel = blue.calls.find((call) => call.url.endsWith('/CancelWaybill'));
  assert.equal(cancel.method, 'POST');
  assert.equal(cancel.body.Request.AWBNo, 'BD89186876973');
  const tracked = await bluedart.track(creds, 'BD89186876973', { request: blue.request });
  assert.match(blue.calls.at(-1).url, /tracking\/v1\/shipment\?/);
  assert.deepEqual(tracked.events.map((row) => row.status), ['picked_up', 'in_transit', 'delivered']);
});

test('Shipway-only Blue Dart tracks via RoutingServlet without Apigee Client ID', async () => {
  const calls = [];
  const request = async (method, url) => {
    calls.push({ method, url });
    assert.match(url, /api\.bluedart\.com\/servlet\/RoutingServlet/);
    return {
      status: 200,
      text: JSON.stringify({
        ShipmentData: {
          Shipment: {
            Status: 'SHIPMENT DELIVERED',
            WaybillNo: 'BD123',
            Scans: [{ ScanDetail: { Scan: 'SHIPMENT DELIVERED', ScanDate: '2026-11-17', ScanTime: '10:00' } }],
          },
        },
      }),
    };
  };
  const tracked = await bluedart.track({
    apiMode: 'live',
    loginId: 'DEL79448',
    licenceKey: 'lic',
    trackingLicenceKey: 'track-lic',
  }, 'BD123', { request });
  assert.equal(calls[0].method, 'GET');
  assert.equal(tracked.status, 'delivered');
  assert.equal(tracked.events.length, 1);
});

test('Blue Dart tracking codes map to OMSKing scan statuses', () => {
  assert.equal(bluedart.mapScanStatus('Shipment Picked Up'), 'picked_up');
  assert.equal(bluedart.mapScanStatus('Out for Delivery'), 'out_for_delivery');
  assert.equal(bluedart.mapScanStatus('SHIPMENT DELIVERED'), 'delivered');
  assert.equal(bluedart.mapScanStatus('RTO Undelivered'), 'rto');
  assert.equal(bluedart.mapScanStatus('Unknown'), '');
});

test('booking a Shopify order on Blue Dart needs no typed AWB, stores the label and fulfils Shopify', async () => {
  const tenant = await seller();
  await CourierAccount.create({
    tenantId: tenant._id, source: 'own', code: 'bluedart', name: 'Bluedart', status: 'active',
    credentialsEnc: encryptObject(creds),
  });
  await shopifyOrder(tenant._id, 'SHP-BD-API');
  const blue = blueMock();
  const shopify = shopifyMock();
  const shipment = await bookOtherCourier(tenant._id, 'SHP-BD-API', { courier: 'bluedart' }, {
    bluedartCreds: creds,
    bluedartRequest: blue.request,
    shopifyCreds: shopCreds,
    shopifyRequest: shopify.request,
  });
  assert.equal(shipment.courier, 'bluedart');
  assert.equal(shipment.awb, 'BD89186876973');
  assert.equal(shipment.labelPdf.toString(), PDF.toString());
  assert.equal(shipment.shopifyFulfillmentId, '88');
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-BD-API' });
  assert.equal(order.courier, 'Bluedart');
  assert.equal(order.awb, 'BD89186876973');
  assert.equal(order.status, 'Dispatched');
  assert.equal((await courierLabelPdf(tenant._id, 'SHP-BD-API')).toString(), PDF.toString());
  const readiness = await shippingReadiness(tenant._id);
  assert.equal(readiness.couriers.find((row) => row.code === 'bluedart')?.api, true);
});

test('a failed Shopify fulfil after Blue Dart booked keeps the AWB and resumes without a second waybill', async () => {
  const tenant = await seller();
  await CourierAccount.create({
    tenantId: tenant._id, source: 'own', code: 'bluedart', name: 'Bluedart', status: 'active',
    credentialsEnc: encryptObject(creds),
  });
  await shopifyOrder(tenant._id, 'SHP-BD-RETRY');
  const blue = blueMock();
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
    () => bookOtherCourier(tenant._id, 'SHP-BD-RETRY', { courier: 'bluedart' }, {
      bluedartCreds: creds, bluedartRequest: blue.request, shopifyCreds: shopCreds, shopifyRequest,
    }),
    /Shopify down/,
  );
  assert.equal(blue.calls.filter((call) => call.url.endsWith('/GenerateWayBill')).length, 1);
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-BD-RETRY' });
  assert.equal(order.status, 'Dispatched');
  assert.equal(order.awb, 'BD89186876973');
  const firstShip = await Shipment.findOne({ tenantId: tenant._id, orderNo: 'SHP-BD-RETRY', status: 'booked' });
  assert.equal(firstShip.shopifyFulfillmentId || '', '');
  const shipment = await bookOtherCourier(tenant._id, 'SHP-BD-RETRY', { courier: 'bluedart' }, {
    bluedartCreds: creds, bluedartRequest: blue.request, shopifyCreds: shopCreds, shopifyRequest,
  });
  assert.equal(shipment.awb, 'BD89186876973');
  assert.equal(shipment.shopifyFulfillmentId, '99');
  assert.equal(blue.calls.filter((call) => call.url.endsWith('/GenerateWayBill')).length, 1);
});

test('cancelling a Blue Dart label calls CancelWaybill and clears the order AWB', async () => {
  const tenant = await seller();
  await CourierAccount.create({
    tenantId: tenant._id, source: 'own', code: 'bluedart', name: 'Bluedart', status: 'active',
    credentialsEnc: encryptObject(creds),
  });
  await shopifyOrder(tenant._id, 'SHP-BD-CXL');
  const blue = blueMock();
  const shopify = shopifyMock();
  await bookOtherCourier(tenant._id, 'SHP-BD-CXL', { courier: 'bluedart' }, {
    bluedartCreds: creds, bluedartRequest: blue.request, shopifyCreds: shopCreds, shopifyRequest: shopify.request,
  });
  await cancelShopifyLabel(tenant._id, 'SHP-BD-CXL', {
    deps: { bluedartCreds: creds, bluedartRequest: blue.request, shopifyCreds: shopCreds, shopifyRequest: shopify.request },
  });
  assert.ok(blue.calls.some((call) => call.url.endsWith('/CancelWaybill')));
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-BD-CXL' });
  assert.equal(order.awb, '');
  assert.equal(order.status, 'New');
});

test('open-shipment tracking sends Blue Dart orders to Blue Dart', async () => {
  const tenant = await seller();
  await Order.create({
    tenantId: tenant._id, orderNo: 'SHP-BD-TRK', channel: 'Shopify', status: 'Dispatched',
    courier: 'Bluedart', awb: 'BD777', source: 'manual',
  });
  await Shipment.create({
    tenantId: tenant._id, orderNo: 'SHP-BD-TRK', channel: 'shopify', courier: 'bluedart',
    awb: 'BD777', status: 'booked', bookedAt: new Date(),
  });
  const blue = blueMock();
  const result = await pollOpenShipments(tenant._id, {
    bluedartCreds: creds,
    bluedartRequest: blue.request,
    delhiveryCreds: {},
  });
  assert.equal(result.checked, 1);
  assert.ok(blue.calls.some((call) => call.url.includes('/tracking/v1/shipment')));
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-BD-TRK' });
  assert.equal(order.status, 'Delivered');
});
