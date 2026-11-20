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
const amazonShipping = require('../src/adapters/couriers/amazonShipping');
const {
  bookOtherCourier,
  cancelShopifyLabel,
  shippingReadiness,
  courierLabelPdf,
} = require('../src/services/ship.service');

let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

const creds = {
  clientId: 'amzn1.application-oa2-client.test',
  clientSecret: 'client-secret-test',
  refreshToken: 'Atzr|refresh-test',
  apiMode: 'sandbox',
};
const shopCreds = { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' };
const PDF = Buffer.from('%PDF-1.4 amazon label');

function amazonMock({ ratesStatus = 200, trackEvents = [{ eventCode: 'PickupDone', eventTime: '2026-11-12T05:00:00Z' }] } = {}) {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    const body = typeof opts.body === 'string' && opts.body.startsWith('{') ? JSON.parse(opts.body) : opts.body;
    calls.push({ method, url, headers: opts.headers || {}, body });
    if (url === 'https://api.amazon.com/auth/o2/token') {
      return { status: 200, text: JSON.stringify({ access_token: 'Atza|access-test' }) };
    }
    if (url.endsWith('/shipping/v2/shipments/rates')) {
      if (ratesStatus === 403) {
        return { status: 403, text: JSON.stringify({ errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }] }) };
      }
      if (ratesStatus !== 200) {
        return { status: ratesStatus, text: JSON.stringify({ errors: [{ code: 'InvalidInput', message: 'Ship to postal code is not serviceable' }] }) };
      }
      return {
        status: 200,
        text: JSON.stringify({
          payload: {
            requestToken: 'req-token-1',
            rates: [
              { rateId: 'rate-costly', carrierId: 'ATS', serviceId: 'SWA-IN-PREM', totalCharge: { value: 120, unit: 'INR' }, supportedDocumentSpecifications: [{ format: 'PDF', size: { width: 4, length: 6, unit: 'INCH' } }] },
              { rateId: 'rate-cheap', carrierId: 'ATS', serviceId: 'SWA-IN-STD', totalCharge: { value: 70, unit: 'INR' }, supportedDocumentSpecifications: [{ format: 'PDF', size: { width: 4, length: 6, unit: 'INCH' } }] },
            ],
          },
        }),
      };
    }
    if (url.endsWith('/shipping/v2/shipments')) {
      return {
        status: 200,
        text: JSON.stringify({
          payload: {
            shipmentId: 'amzn-ship-1',
            packageDocumentDetails: [{
              packageClientReferenceId: 'SHP-AS',
              trackingId: 'ATS123456',
              packageDocuments: [{ type: 'LABEL', format: 'PDF', contents: PDF.toString('base64') }],
            }],
          },
        }),
      };
    }
    if (/\/shipping\/v2\/shipments\/[^/]+\/cancel$/.test(url)) return { status: 200, text: '{"payload":{}}' };
    if (url.includes('/shipping/v2/tracking')) {
      const trackingId = new URL(url).searchParams.get('trackingId');
      return { status: 200, text: JSON.stringify({ payload: { trackingId, summary: { status: 'InTransit' }, eventHistory: trackEvents } }) };
    }
    throw new Error(`unexpected Amazon call ${method} ${url}`);
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
  pincode: '302001',
  phone: '9111111111',
  orderNo: 'SHP-AS',
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

test('Amazon Shipping book gets rates, buys the cheapest on the India sandbox, and returns AWB and label PDF', async () => {
  const amazon = amazonMock();
  const booked = await amazonShipping.book(creds, parcel, { request: amazon.request });
  assert.equal(booked.awb, 'ATS123456');
  assert.equal(booked.shipmentId, 'amzn-ship-1');
  assert.ok(Buffer.isBuffer(booked.labelPdf));
  assert.equal(booked.labelPdf.toString(), PDF.toString());

  const [token, rates, purchase] = amazon.calls;
  assert.equal(token.url, 'https://api.amazon.com/auth/o2/token');
  assert.equal(rates.url, 'https://sandbox.sellingpartnerapi-eu.amazon.com/shipping/v2/shipments/rates');
  assert.equal(rates.headers['x-amz-access-token'], 'Atza|access-test');
  assert.equal(rates.headers['x-amzn-shipping-business-id'], 'AmazonShipping_IN');
  assert.equal(rates.body.shipTo.postalCode, '302001');
  assert.equal(rates.body.shipTo.countryCode, 'IN');
  assert.equal(rates.body.shipFrom.postalCode, '302002');
  assert.deepEqual(rates.body.packages[0].weight, { unit: 'GRAM', value: 500 });
  assert.equal(rates.body.packages[0].dimensions.unit, 'CENTIMETER');
  assert.equal(rates.body.packages[0].packageClientReferenceId, 'SHP-AS');
  assert.equal(rates.body.valueAddedServices, undefined);
  assert.equal(purchase.body.requestToken, 'req-token-1');
  assert.equal(purchase.body.rateId, 'rate-cheap');
  assert.equal(purchase.body.requestedDocumentSpecification.format, 'PDF');
  assert.equal(amazon.calls.length, 3);
});

test('Amazon Shipping asks for cash on delivery on COD parcels', async () => {
  const amazon = amazonMock();
  await amazonShipping.book(creds, { ...parcel, paymentMode: 'COD', codAmount: 2299 }, { request: amazon.request });
  assert.deepEqual(amazon.calls[1].body.valueAddedServices, { collectOnDelivery: { amount: { value: 2299, unit: 'INR' } } });
});

test('Amazon Shipping is never called without an API environment or with missing package size', async () => {
  await assert.rejects(() => amazonShipping.book({ ...creds, apiMode: '' }, parcel), /Live API was not called/);
  const amazon = amazonMock();
  await assert.rejects(() => amazonShipping.book(creds, { ...parcel, weightGrams: 0 }, { request: amazon.request }), /weight and size/);
  await assert.rejects(() => amazonShipping.book({ ...creds, refreshToken: '' }, parcel, { request: amazon.request }), /refresh token/);
  assert.equal(amazon.calls.length, 0);
});

test('Amazon Shipping errors show the Amazon message and buy nothing', async () => {
  const amazon = amazonMock({ ratesStatus: 400 });
  await assert.rejects(() => amazonShipping.book(creds, parcel, { request: amazon.request }), /not serviceable/);
  assert.equal(amazon.calls.some((call) => call.url.endsWith('/shipping/v2/shipments')), false);
});

test('Amazon Shipping 403 tells the user to add the Amazon Logistics role and buys nothing', async () => {
  const amazon = amazonMock({ ratesStatus: 403 });
  const err = await amazonShipping.book(creds, parcel, { request: amazon.request }).then(() => null, (e) => e);
  assert.ok(err, 'book should fail on 403');
  assert.equal(err.statusCode, 400);
  assert.equal(err.terminal, true);
  assert.match(err.message, /returned 403/);
  assert.match(err.message, /Access to requested resource is denied/);
  assert.match(err.message, /Amazon Logistics role/);
  assert.match(err.message, /Direct-to-Consumer Shipping is not needed/);
  assert.match(err.message, /new refresh token/);
  assert.doesNotMatch(err.message, /Atzr\||client-secret-test/);
  assert.equal(amazon.calls.some((call) => call.url.endsWith('/shipping/v2/shipments')), false);
});

test('Amazon Shipping courier form names the Amazon Logistics role', () => {
  const { OWN } = require('../src/constants/courierCatalog');
  const entry = OWN.find((item) => item.name === 'Amazon Shipping');
  assert.ok(entry, 'Amazon Shipping own-account entry exists');
  assert.match(entry.blurb, /Amazon Logistics role/);
});

test('Amazon Shipping cancel and tracking call the v2 shipment endpoints', async () => {
  const amazon = amazonMock();
  await amazonShipping.cancel(creds, 'amzn-ship-1', { request: amazon.request });
  const cancel = amazon.calls.find((call) => call.url.endsWith('/cancel'));
  assert.equal(cancel.method, 'PUT');
  assert.equal(cancel.url, 'https://sandbox.sellingpartnerapi-eu.amazon.com/shipping/v2/shipments/amzn-ship-1/cancel');
  const tracked = await amazonShipping.track(creds, { trackingId: 'ATS123456', carrierId: 'ATS' }, { request: amazon.request });
  assert.equal(tracked.status, 'InTransit');
  assert.match(amazon.calls.at(-1).url, /tracking\?trackingId=ATS123456&carrierId=ATS$/);
  assert.deepEqual(tracked.events, [{ status: 'picked_up', detail: 'PickupDone', eventKey: 'ATS123456:2026-11-12T05:00:00Z:picked_up' }]);
});

test('Amazon Shipping tracking codes map to the OMSKing scan statuses; unknown codes are skipped', async () => {
  const amazon = amazonMock({
    trackEvents: [
      { eventCode: 'ReadyForReceive', eventTime: 't0' },
      { eventCode: 'PickupDone', eventTime: 't1' },
      { eventCode: 'Departed', eventTime: 't2' },
      { eventCode: 'OutForDelivery', eventTime: 't3' },
      { eventCode: 'DeliveryAttempted', eventTime: 't4' },
      { eventCode: 'ReturnInitiated', eventTime: 't5' },
      { eventCode: 'Delivered', eventTime: 't6' },
    ],
  });
  const tracked = await amazonShipping.track(creds, { trackingId: 'ATS1', carrierId: 'ATS' }, { request: amazon.request });
  assert.deepEqual(tracked.events.map((row) => row.status), ['picked_up', 'in_transit', 'out_for_delivery', 'ndr', 'rto', 'delivered']);
});

async function seller() {
  const tenant = await Tenant.create({ name: 'Leheriya', slug: `as-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: 'merchant' });
  await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Leheriya',
    type: 'physical',
    isPickup: true,
    address: { line1: 'Workshop lane', city: 'Jaipur', state: 'Rajasthan', pincode: '302002' },
    contactPhone: '9000000000',
  });
  await CourierAccount.create({ tenantId: tenant._id, source: 'own', code: 'amazon-shipping', name: 'Amazon Shipping', status: 'active' });
  return tenant;
}

async function shopifyOrder(tenantId, orderNo) {
  return Order.create({
    tenantId,
    orderNo,
    channel: 'Shopify',
    paymentMode: 'Prepaid',
    customer: 'Asha',
    phone: '9111111111',
    address: '12 MG Road',
    city: 'Jaipur 302001',
    total: 2299,
    externalOrderId: `gid-${orderNo}`,
    items: [{ name: 'Kurta', sku: 'KURTA-RED-L', qty: 1, price: 2299, pack: { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 4 } }],
    source: 'manual',
  });
}

test('booking a Shopify order on Amazon Shipping needs no typed AWB, stores the label and fulfils Shopify', async () => {
  const tenant = await seller();
  const { couriers } = await shippingReadiness(tenant._id);
  assert.equal(couriers.find((row) => row.code === 'amazon-shipping').api, true);

  await shopifyOrder(tenant._id, 'SHP-AS');
  const amazon = amazonMock();
  const shopify = shopifyMock();
  const deps = { amazonShippingCreds: creds, amazonShippingRequest: amazon.request, shopifyCreds: shopCreds, shopifyRequest: shopify.request };
  const shipment = await bookOtherCourier(tenant._id, 'SHP-AS', { courier: 'amazon-shipping' }, deps);
  assert.equal(shipment.courier, 'amazon-shipping');
  assert.equal(shipment.awb, 'ATS123456');
  assert.equal(shipment.channelPackageId, 'amzn-ship-1');
  assert.equal(shipment.carrierId, 'ATS');
  assert.equal(shipment.shopifyFulfillmentId, '88');
  const fulfil = shopify.calls.find((call) => call.url.endsWith('/fulfillments.json'));
  assert.equal(fulfil.body.fulfillment.tracking_info.number, 'ATS123456');
  assert.equal(fulfil.body.fulfillment.tracking_info.company, 'Amazon Shipping');
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-AS' });
  assert.equal(order.awb, 'ATS123456');
  assert.equal(order.courier, 'Amazon Shipping');
  assert.equal(order.status, 'Dispatched');
  assert.equal((await courierLabelPdf(tenant._id, 'SHP-AS')).toString(), PDF.toString());

  const before = amazon.calls.length;
  await assert.rejects(() => bookOtherCourier(tenant._id, 'SHP-AS', { courier: 'amazon-shipping' }, deps), /already/);
  assert.equal(amazon.calls.length, before);

  await cancelShopifyLabel(tenant._id, 'SHP-AS', { deps });
  assert.ok(amazon.calls.some((call) => call.method === 'PUT' && call.url.endsWith('/shipments/amzn-ship-1/cancel')));
  const cancelled = await Shipment.findById(shipment._id);
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(shopify.calls.some((call) => call.url.includes('/cancel.json')));
});

test('a failed Shopify fulfil after Amazon booked keeps the AWB and resumes without a second Amazon label', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'SHP-AS2');
  const amazon = amazonMock();
  const failing = async () => ({ status: 500, text: '{}' });
  await assert.rejects(
    () => bookOtherCourier(tenant._id, 'SHP-AS2', { courier: 'amazon-shipping' }, {
      amazonShippingCreds: creds, amazonShippingRequest: amazon.request, shopifyCreds: shopCreds, shopifyRequest: failing,
    }),
    /Shopify fulfillments returned 500|Shopify was not marked fulfilled/i,
  );
  const bought = amazon.calls.filter((call) => call.url.endsWith('/shipping/v2/shipments')).length;
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-AS2' });
  assert.ok(order.awb);
  const shopify = shopifyMock();
  const shipment = await bookOtherCourier(tenant._id, 'SHP-AS2', { courier: 'amazon-shipping' }, {
    amazonShippingCreds: creds, amazonShippingRequest: amazon.request, shopifyCreds: shopCreds, shopifyRequest: shopify.request,
  });
  assert.equal(shipment.shopifyFulfillmentId, '88');
  assert.equal(amazon.calls.filter((call) => call.url.endsWith('/shipping/v2/shipments')).length, bought);
});

function delhiveryTrackMock() {
  const calls = [];
  const request = async (method, url) => {
    calls.push({ method, url });
    if (url.includes('/api/v1/packages/json/')) {
      return { status: 200, text: JSON.stringify({ ShipmentData: [{ Shipment: { Scans: [{ ScanDetail: { Scan: 'Delivered', Instructions: 'Delivered', ScanDateTime: 'd1' } }] } }] }) };
    }
    throw new Error(`unexpected Delhivery call ${url}`);
  };
  return { calls, request };
}

async function dispatched(tenantId, orderNo, courier, awb) {
  return Order.create({ tenantId, orderNo, channel: 'Shopify', status: 'Dispatched', courier, awb, source: 'manual' });
}

test('open-shipment tracking sends Amazon Shipping orders to Amazon and only Delhivery orders to Delhivery', async () => {
  const { pollOpenShipments } = require('../src/services/tracking.service');
  const tenant = await seller();
  await dispatched(tenant._id, 'SHP-AMZ', 'Amazon Shipping', 'ATS777');
  await Shipment.create({
    tenantId: tenant._id, orderNo: 'SHP-AMZ', channel: 'shopify', courier: 'amazon-shipping', awb: 'ATS777',
    status: 'booked', channelPackageId: 'amzn-ship-7', carrierId: 'ATS', bookedAt: new Date(),
  });
  await dispatched(tenant._id, 'SHP-DLV', 'Delhivery', 'DLV777');
  await dispatched(tenant._id, 'SHP-BD', 'Bluedart', 'BD777');

  const amazon = amazonMock({ trackEvents: [{ eventCode: 'PickupDone', eventTime: 't1' }, { eventCode: 'Delivered', eventTime: 't2' }] });
  const delhivery = delhiveryTrackMock();
  const result = await pollOpenShipments(tenant._id, {
    delhiveryCreds: { apiToken: 'dlv-test' },
    delhiveryRequest: delhivery.request,
    amazonShippingCreds: creds,
    amazonShippingRequest: amazon.request,
  });

  assert.equal(result.failed, 0);
  assert.equal(result.checked, 2);
  assert.deepEqual(delhivery.calls.map((call) => new URL(call.url).searchParams.get('waybill')), ['DLV777']);
  const tracking = amazon.calls.filter((call) => call.url.includes('/shipping/v2/tracking'));
  assert.equal(tracking.length, 1);
  assert.match(tracking[0].url, /trackingId=ATS777&carrierId=ATS$/);

  const amz = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-AMZ' });
  assert.equal(amz.status, 'Delivered');
  assert.ok(amz.pickedUpAt);
  const amzShipment = await Shipment.findOne({ tenantId: tenant._id, orderNo: 'SHP-AMZ', status: 'booked' });
  assert.equal(amzShipment.deliveryStatus, 'delivered');
  assert.equal(amzShipment.trackingEvents.length, 2);
  assert.equal((await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-BD' })).status, 'Dispatched');

  const again = await pollOpenShipments(tenant._id, {
    delhiveryCreds: { apiToken: 'dlv-test' }, delhiveryRequest: delhivery.request,
    amazonShippingCreds: creds, amazonShippingRequest: amazon.request,
  });
  assert.equal(again.checked, 0, 'delivered orders are no longer polled');
});

test('Amazon Shipping orders are tracked even when the company has no Delhivery token', async () => {
  const { pollOpenShipments, pollDelhivery } = require('../src/services/tracking.service');
  const tenant = await seller();
  await dispatched(tenant._id, 'SHP-AMZ2', 'Amazon Shipping', 'ATS888');
  await Shipment.create({
    tenantId: tenant._id, orderNo: 'SHP-AMZ2', channel: 'shopify', courier: 'amazon-shipping', awb: 'ATS888',
    status: 'booked', channelPackageId: 'amzn-ship-8', carrierId: 'ATS', bookedAt: new Date(),
  });
  const amazon = amazonMock({ trackEvents: [{ eventCode: 'OutForDelivery', eventTime: 't1' }] });
  const result = await pollOpenShipments(tenant._id, { delhiveryCreds: {}, amazonShippingCreds: creds, amazonShippingRequest: amazon.request });
  assert.equal(result.checked, 1);
  assert.equal(result.failed, 0);
  await assert.rejects(() => pollDelhivery(tenant._id, 'SHP-AMZ2', { delhiveryCreds: { apiToken: 'dlv-test' } }), /Delhivery was not called/);
});
