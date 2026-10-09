process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Warehouse = require('../src/models/Warehouse');
const MasterSku = require('../src/models/MasterSku');
const Shipment = require('../src/models/Shipment');
const InventoryReservation = require('../src/models/InventoryReservation');
const IntegrationJob = require('../src/models/IntegrationJob');
const { stockIn, reserveStock } = require('../src/services/inventory.service');
const shopifyAdapter = require('../src/adapters/shopify');
const { paymentView } = require('../src/services/orderDesk.service');
const {
  bookShopify,
  cancelShopifyLabel,
  bookMarketplace,
  releaseVendorSlice,
  releaseOrderReserve,
  queueBulkLabels,
  closeDayManifest,
  runShipmentJob,
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

const shopCreds = { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' };
const delhiveryCreds = { apiToken: 'dlv-test', pickupWarehouse: 'WH-001', clientName: 'Leheriya' };

function delhiveryMock() {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes('pin-codes')) {
      return { status: 200, text: JSON.stringify({ delivery_codes: [{ postal_code: { pre_paid: 'Y', cash: 'Y' } }] }) };
    }
    if (url.includes('/api/cmu/create.json')) {
      const n = calls.filter((call) => call.url.includes('create.json')).length;
      return { status: 200, text: JSON.stringify({ packages: [{ waybill: `AWB-${n}`, status: 'Success' }] }) };
    }
    if (url.includes('packing_slip')) return { status: 200, text: '%PDF-1.4 label' };
    if (url.includes('/fm/request/new')) return { status: 200, text: '{}' };
    if (url.includes('/api/p/edit')) return { status: 200, text: '{}' };
    throw new Error(`unexpected Delhivery call ${url}`);
  };
  return { calls, request };
}

function shopifyMock() {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes('fulfillment_orders')) {
      return { status: 200, text: JSON.stringify({ fulfillment_orders: [{ id: 77 }] }) };
    }
    if (url.endsWith('/fulfillments.json')) {
      return { status: 200, text: JSON.stringify({ fulfillment: { id: 88 } }) };
    }
    if (url.includes('/cancel.json')) return { status: 200, text: '{}' };
    throw new Error(`unexpected Shopify call ${url}`);
  };
  return { calls, request };
}

async function seller() {
  const tenant = await Tenant.create({ name: 'Ship shop', slug: `ship-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: 'merchant' });
  await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Pickup',
    type: 'physical',
    isPickup: true,
    address: { line1: 'Workshop lane', city: 'Jaipur', pincode: '302001' },
    contactPhone: '9000000000',
  });
  return tenant;
}

async function shopifyOrder(tenantId, orderNo) {
  return Order.create({
    tenantId,
    orderNo,
    channel: 'Shopify',
    paymentMode: 'Prepaid',
    city: 'Jaipur 302001',
    externalOrderId: `gid-${orderNo}`,
    items: [{ name: 'Kurta', sku: 'KURTA-RED-L', qty: 1 }],
    source: 'manual',
  });
}

test('one Shopify order books one Delhivery AWB and marks Shopify fulfilled', async () => {
  const tenant = await seller();
  const sku = await MasterSku.create({ tenantId: tenant._id, code: 'KURTA-RED-L', name: 'Kurta' });
  const warehouse = await Warehouse.findOne({ tenantId: tenant._id, code: 'WH-001' });
  await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: warehouse._id, qty: 2, reason: 'opening' });
  const order = await shopifyOrder(tenant._id, 'SHP-1');
  await reserveStock(String(tenant._id), null, {
    masterSkuId: sku._id,
    warehouseId: warehouse._id,
    channel: 'shopify',
    qty: 1,
    idempotencyKey: 'shp-1',
    orderRef: order.orderNo,
  });
  const delhivery = delhiveryMock();
  const shopify = shopifyMock();
  const deps = {
    delhiveryCreds,
    delhiveryRequest: delhivery.request,
    shopifyCreds: shopCreds,
    shopifyRequest: shopify.request,
  };
  const shipment = await bookShopify(tenant._id, order.orderNo, deps);
  assert.equal(shipment.courier, 'delhivery');
  assert.equal(shipment.awb, 'AWB-1');
  assert.equal(shipment.shopifyFulfillmentId, '88');
  assert.equal(shipment.labelPdf.slice(0, 4).toString(), '%PDF');
  assert.equal(delhivery.calls.filter((call) => call.url.includes('create.json')).length, 1);
  const fulfill = shopify.calls.find((call) => call.url.endsWith('/fulfillments.json'));
  assert.equal(fulfill.body.fulfillment.tracking_info.number, 'AWB-1');
  assert.equal(fulfill.body.fulfillment.tracking_info.company, 'Delhivery');
  assert.equal(delhivery.calls.filter((call) => call.url.includes('/fm/request/new')).length, 0);

  await cancelShopifyLabel(tenant._id, order.orderNo, { releaseReserve: false, deps });
  const cancelled = await Shipment.findOne({ tenantId: tenant._id, orderNo: order.orderNo });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(shopify.calls.some((call) => call.url.includes('/fulfillments/88/cancel.json')), true);
  assert.equal(delhivery.calls.some((call) => call.url.includes('/api/p/edit')), true);
  const stillHeld = await InventoryReservation.findOne({ tenantId: tenant._id, orderRef: order.orderNo });
  assert.equal(stillHeld.status, 'held');
  const fresh = await Order.findOne({ tenantId: tenant._id, orderNo: order.orderNo });
  assert.equal(fresh.awb, '');
  assert.equal(fresh.status, 'New');

  await releaseOrderReserve(tenant._id, fresh);
  const released = await InventoryReservation.findOne({ tenantId: tenant._id, orderRef: order.orderNo });
  assert.equal(released.status, 'released');
});

test('one Amazon order stores marketplace tracking and never calls Delhivery', async () => {
  const tenant = await seller();
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'AMZ-1',
    channel: 'Amazon',
    externalOrderId: '902-1',
    source: 'channel_api',
  });
  let delhiveryCalls = 0;
  const amazonCalls = [];
  const shipment = await bookMarketplace(tenant._id, 'AMZ-1', {
    amazonCreds: { sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's', apiMode: 'live' },
    amazonRequest: async (method, url) => {
      amazonCalls.push(url);
      if (url.includes('/auth/o2/token')) return { status: 200, text: JSON.stringify({ access_token: 'tok' }) };
      return { status: 200, text: JSON.stringify({ trackingDetails: { trackingId: 'AMZ-TRACK-9' } }) };
    },
    delhiveryRequest: async () => { delhiveryCalls += 1; },
  });
  assert.equal(delhiveryCalls, 0);
  assert.equal(shipment.courier, 'amazon');
  assert.equal(shipment.awb, 'AMZ-TRACK-9');
  assert.equal(amazonCalls.some((url) => url.includes('/easyShip/2022-03-23/package')), true);
});

test('today\'s WH-001 manifest requests one pickup for the AWBs booked today', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'SHP-M1');
  await shopifyOrder(tenant._id, 'SHP-M2');
  const delhivery = delhiveryMock();
  const shopify = shopifyMock();
  const deps = {
    delhiveryCreds,
    delhiveryRequest: delhivery.request,
    shopifyCreds: shopCreds,
    shopifyRequest: shopify.request,
  };
  await bookShopify(tenant._id, 'SHP-M1', deps);
  await bookShopify(tenant._id, 'SHP-M2', deps);
  const manifest = await closeDayManifest(tenant._id, deps);
  assert.equal(manifest.count, 2);
  assert.equal(manifest.warehouseCode, 'WH-001');
  assert.deepEqual(manifest.rows.map((row) => row.awb).sort(), ['AWB-1', 'AWB-2']);
  const pickups = delhivery.calls.filter((call) => call.url.includes('/fm/request/new'));
  assert.equal(pickups.length, 1);
  assert.equal(pickups[0].body.expected_package_count, 2);
  await assert.rejects(() => closeDayManifest(tenant._id, deps), /waiting for today's/);
  assert.equal(delhivery.calls.filter((call) => call.url.includes('/fm/request/new')).length, 1);
});

test('a Myntra order stores partner tracking and never calls Delhivery', async () => {
  const tenant = await seller();
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'MYN-1',
    channel: 'Myntra',
    externalOrderId: 'SO-1',
    source: 'channel_api',
    channelLines: [{ sellerOrderId: 'SO-1', packetId: 'PKT-1' }],
  });
  let delhiveryCalls = 0;
  const shipment = await bookMarketplace(tenant._id, 'MYN-1', {
    myntraCreds: { merchantId: 'M1', secretKey: 'S1', storeId: 'STORE1' },
    myntraClient: { readyToDispatch: async () => ({ trackingNumber: 'MYN-TRACK-4' }) },
    delhiveryRequest: async () => { delhiveryCalls += 1; },
  });
  assert.equal(delhiveryCalls, 0);
  assert.equal(shipment.courier, 'myntra');
  assert.equal(shipment.awb, 'MYN-TRACK-4');
});

test('bulk labels are one job and one pickup', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'SHP-A');
  await shopifyOrder(tenant._id, 'SHP-B');
  const job = await queueBulkLabels(tenant._id, null, ['SHP-A', 'SHP-B', 'SHP-A']);
  const rows = await IntegrationJob.find({ tenantId: tenant._id, jobType: 'shipment_push' });
  assert.equal(rows.length, 1);
  assert.deepEqual(job.payload.orderNos, ['SHP-A', 'SHP-B']);
  const delhivery = delhiveryMock();
  const shopify = shopifyMock();
  const result = await runShipmentJob(job, {
    delhiveryCreds,
    delhiveryRequest: delhivery.request,
    shopifyCreds: shopCreds,
    shopifyRequest: shopify.request,
  });
  assert.equal(result.booked, 2);
  assert.equal(delhivery.calls.filter((call) => call.url.includes('create.json')).length, 2);
  const pickups = delhivery.calls.filter((call) => call.url.includes('/fm/request/new'));
  assert.equal(pickups.length, 1);
  assert.equal(pickups[0].body.expected_package_count, 2);
});

test('vendor reject releases that line and leaves it free to assign again', async () => {
  const tenant = await seller();
  const sku = await MasterSku.create({ tenantId: tenant._id, code: 'SAREE-1', name: 'Saree' });
  const warehouse = await Warehouse.findOne({ tenantId: tenant._id, code: 'WH-001' });
  await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: warehouse._id, qty: 3, reason: 'opening' });
  const order = await Order.create({
    tenantId: tenant._id,
    orderNo: 'VEN-1',
    channel: 'Shopify',
    source: 'manual',
    subOrders: [{
      id: 'VEN-1-1',
      index: 1,
      sku: 'SAREE-1',
      masterSkuId: sku._id,
      assignedVendor: 'Workshop',
      vendorStatus: 'Pending Acceptance',
    }],
  });
  await reserveStock(String(tenant._id), null, {
    masterSkuId: sku._id,
    warehouseId: warehouse._id,
    channel: 'manual',
    qty: 1,
    idempotencyKey: 'ven-1',
    orderRef: `${order.orderNo}:${order.subOrders[0].id}`,
  });
  const released = await releaseVendorSlice(tenant._id, order, order.subOrders[0]);
  assert.equal(released, 1);
  const hold = await InventoryReservation.findOne({ tenantId: tenant._id, idempotencyKey: 'ven-1' });
  assert.equal(hold.status, 'released');
  const empty = await releaseVendorSlice(tenant._id, order, order.subOrders[0]);
  assert.equal(empty, 0);
});

function bookedPaymentMode(call) {
  const raw = String(call.body || '');
  const encoded = raw.startsWith('format=json&data=') ? raw.slice('format=json&data='.length) : raw;
  return JSON.parse(decodeURIComponent(encoded)).shipments[0].payment_mode;
}

test('partially paid books as COD and a void order is not sent to Delhivery as COD', async () => {
  const partial = shopifyAdapter.mapShopifyOrder({
    id: 501,
    financial_status: 'partially_paid',
    payment_gateway_names: ['Cash on Delivery'],
    line_items: [{ title: 'Kurta', sku: 'KURTA-RED-L', quantity: 1, price: '499.00' }],
  }, {});
  assert.equal(partial.paymentMode, 'Partially paid');
  assert.deepEqual(paymentView(partial.paymentMode), { paymentMode: 'COD', paymentDetail: 'Partially paid' });

  const voided = shopifyAdapter.mapShopifyOrder({
    id: 502,
    financial_status: 'voided',
    payment_gateway_names: ['Cash on Delivery'],
    line_items: [{ title: 'Kurta', sku: 'KURTA-RED-L', quantity: 1, price: '499.00' }],
  }, {});
  assert.equal(voided.paymentMode, 'Void');
  assert.equal(paymentView(voided.paymentMode).paymentMode, 'Void');

  const tenant = await seller();
  const order = await shopifyOrder(tenant._id, 'SHP-PART');
  order.paymentMode = 'Partially paid';
  await order.save();
  const delhivery = delhiveryMock();
  const shopify = shopifyMock();
  const deps = {
    delhiveryCreds,
    delhiveryRequest: delhivery.request,
    shopifyCreds: shopCreds,
    shopifyRequest: shopify.request,
  };
  await bookShopify(tenant._id, 'SHP-PART', deps);
  const created = delhivery.calls.find((call) => call.url.includes('create.json'));
  assert.equal(bookedPaymentMode(created), 'COD');
  const saved = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-PART' });
  assert.equal(saved.paymentStatus || '', '');
  assert.notEqual(saved.paymentStatus, 'paid');

  const blank = await shopifyOrder(tenant._id, 'SHP-VOID');
  blank.paymentMode = 'Void';
  await blank.save();
  const before = delhivery.calls.length;
  await assert.rejects(() => bookShopify(tenant._id, 'SHP-VOID', deps), /Void/);
  assert.equal(delhivery.calls.length, before);
  assert.equal(delhivery.calls.some((call) => String(call.body || '').includes('"payment_mode":"COD"') && call.url.includes('SHP-VOID')), false);
});
