process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Warehouse = require('../src/models/Warehouse');
const Shipment = require('../src/models/Shipment');
const NdrCase = require('../src/models/NdrCase');
const HandoverManifest = require('../src/models/HandoverManifest');
const CourierAccount = require('../src/models/CourierAccount');
const { mapScanStatus } = require('../src/adapters/couriers/delhivery');
const { bookShopify, bookOtherCourier, cancelShopifyLabel, assertStatusChange } = require('../src/services/ship.service');
const { applyTracking, convertNdrToRto } = require('../src/services/tracking.service');
const { handOver } = require('../src/services/handover.service');
const { cancelAmazonLabel } = require('../src/services/amazonLabel.service');

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

function delhiveryMock({ failLabelOnce = false } = {}) {
  const calls = [];
  let labelFailed = false;
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes('pin-codes')) {
      return { status: 200, text: JSON.stringify({ delivery_codes: [{ postal_code: { pre_paid: 'Y', cash: 'Y' } }] }) };
    }
    if (url.includes('/api/cmu/create.json')) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const n = calls.filter((call) => call.url.includes('create.json')).length;
      return { status: 200, text: JSON.stringify({ packages: [{ waybill: `AWB-${n}`, status: 'Success' }] }) };
    }
    if (url.includes('packing_slip')) {
      if (failLabelOnce && !labelFailed) {
        labelFailed = true;
        throw new Error('label service down');
      }
      return { status: 200, text: '%PDF-1.4 label' };
    }
    if (url.includes('/api/p/edit')) return { status: 200, text: '{}' };
    throw new Error(`unexpected Delhivery call ${url}`);
  };
  return { calls, request };
}

function shopifyMock({ failCancelOnce = false } = {}) {
  const calls = [];
  let cancelFailed = false;
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes('fulfillment_orders')) return { status: 200, text: JSON.stringify({ fulfillment_orders: [{ id: 77 }] }) };
    if (url.endsWith('/fulfillments.json')) return { status: 200, text: JSON.stringify({ fulfillment: { id: 88 } }) };
    if (url.includes('/cancel.json')) {
      if (failCancelOnce && !cancelFailed) {
        cancelFailed = true;
        throw new Error('shopify down');
      }
      return { status: 200, text: '{}' };
    }
    throw new Error(`unexpected Shopify call ${url}`);
  };
  return { calls, request };
}

async function seller() {
  const tenant = await Tenant.create({ name: 'Ship', slug: `ship-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: 'merchant' });
  await Warehouse.create({
    tenantId: tenant._id, code: 'WH-001', name: 'Pickup', type: 'physical', isPickup: true,
    address: { line1: 'Workshop lane', city: 'Jaipur', pincode: '302001' }, contactPhone: '9000000000',
  });
  return tenant;
}

async function shopifyOrder(tenantId, orderNo, extra = {}) {
  return Order.create({
    tenantId, orderNo, channel: 'Shopify', paymentMode: 'Prepaid', city: 'Jaipur 302001', externalOrderId: `gid-${orderNo}`,
    items: [{ name: 'Kurta', sku: 'KURTA', qty: 1 }], source: 'manual', ...extra,
  });
}

function deps(delhivery, shopify) {
  return { delhiveryCreds, delhiveryRequest: delhivery.request, shopifyCreds: shopCreds, shopifyRequest: shopify.request };
}

const createCalls = (mock) => mock.calls.filter((call) => call.url.includes('create.json')).length;
const fresh = (tenantId, orderNo) => Order.findOne({ tenantId, orderNo }).setOptions({ skipTenantFilter: true });

test('Delhivery scans before pickup (Manifested, Not Picked, Pickup Scheduled) are not treated as picked up', () => {
  assert.equal(mapScanStatus('Manifested'), '');
  assert.equal(mapScanStatus('Not Picked'), '');
  assert.equal(mapScanStatus('Pickup Scheduled'), '');
  assert.equal(mapScanStatus('Picked Up'), 'picked_up');
  assert.equal(mapScanStatus('In Transit'), 'in_transit');
});

test('two label clicks at once book one AWB', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-1');
  const delhivery = delhiveryMock();
  const shopify = shopifyMock();
  const results = await Promise.allSettled([
    bookShopify(tenant._id, 'S-1', deps(delhivery, shopify)),
    bookShopify(tenant._id, 'S-1', deps(delhivery, shopify)),
  ]);
  assert.ok(results.some((row) => row.status === 'fulfilled'));
  assert.equal(createCalls(delhivery), 1);
  assert.equal(await Shipment.countDocuments({ tenantId: tenant._id, orderNo: 'S-1', status: 'booked' }), 1);
});

test('an AWB booked at Delhivery is saved even if the label PDF fails, and a retry does not book again', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-2');
  const delhivery = delhiveryMock({ failLabelOnce: true });
  const shopify = shopifyMock();
  await assert.rejects(bookShopify(tenant._id, 'S-2', deps(delhivery, shopify)));
  const saved = await Shipment.findOne({ tenantId: tenant._id, orderNo: 'S-2', status: 'booked' });
  assert.equal(saved.awb, 'AWB-1');
  const shipment = await bookShopify(tenant._id, 'S-2', deps(delhivery, shopify));
  assert.equal(createCalls(delhivery), 1);
  assert.equal(shipment.awb, 'AWB-1');
  assert.ok(shipment.labelPdf);
  assert.equal((await fresh(tenant._id, 'S-2')).awb, 'AWB-1');
});

test('a retry after the order save failed puts the AWB on the order without calling the courier', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-3');
  await Shipment.create({ tenantId: tenant._id, orderNo: 'S-3', channel: 'shopify', courier: 'delhivery', awb: 'AWB-X', status: 'booked', shopifyFulfillmentId: '88', bookedAt: new Date() });
  const delhivery = delhiveryMock();
  await bookShopify(tenant._id, 'S-3', deps(delhivery, shopifyMock()));
  const order = await fresh(tenant._id, 'S-3');
  assert.equal(order.awb, 'AWB-X');
  assert.equal(order.status, 'Dispatched');
  assert.ok(order.labelGeneratedAt);
  assert.equal(delhivery.calls.length, 0);
});

test('a label cannot be cancelled once the courier picked the parcel up', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-4');
  const delhivery = delhiveryMock();
  const shopify = shopifyMock();
  await bookShopify(tenant._id, 'S-4', deps(delhivery, shopify));
  await applyTracking(tenant._id, { orderNo: 'S-4', awb: 'AWB-1', status: 'picked_up', eventKey: 'p' });
  await assert.rejects(cancelShopifyLabel(tenant._id, 'S-4', { deps: deps(delhivery, shopify) }), /picked/i);
  const order = await fresh(tenant._id, 'S-4');
  assert.equal(order.status, 'Dispatched');
  assert.equal(order.awb, 'AWB-1');
});

test('a cancel that fails at Shopify can be retried without cancelling the AWB twice', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-5');
  const delhivery = delhiveryMock();
  const shopify = shopifyMock({ failCancelOnce: true });
  await bookShopify(tenant._id, 'S-5', deps(delhivery, shopify));
  await assert.rejects(cancelShopifyLabel(tenant._id, 'S-5', { deps: deps(delhivery, shopify) }));
  await cancelShopifyLabel(tenant._id, 'S-5', { deps: deps(delhivery, shopify) });
  assert.equal(delhivery.calls.filter((call) => call.url.includes('/api/p/edit')).length, 1);
  assert.equal((await Shipment.findOne({ tenantId: tenant._id, orderNo: 'S-5' })).status, 'cancelled');
  assert.equal((await fresh(tenant._id, 'S-5')).status, 'New');
});

test('a delivered or in-transit scan after RTO does not mark the order delivered', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-6', { status: 'Dispatched', awb: 'AWB-6', courier: 'Delhivery' });
  await applyTracking(tenant._id, { orderNo: 'S-6', awb: 'AWB-6', status: 'rto', eventKey: 'r' });
  await applyTracking(tenant._id, { orderNo: 'S-6', awb: 'AWB-6', status: 'delivered', eventKey: 'd' });
  const order = await fresh(tenant._id, 'S-6');
  assert.equal(order.status, 'Dispatched');
  assert.equal(order.channelStatus, 'RTO');
});

test('tracking never revives a cancelled order or moves a delivered one backwards', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-7', { status: 'Cancelled', awb: 'AWB-7' });
  await applyTracking(tenant._id, { orderNo: 'S-7', awb: 'AWB-7', status: 'in_transit', eventKey: 't' });
  assert.equal((await fresh(tenant._id, 'S-7')).status, 'Cancelled');
  await shopifyOrder(tenant._id, 'S-8', { status: 'Dispatched', awb: 'AWB-8' });
  await applyTracking(tenant._id, { orderNo: 'S-8', awb: 'AWB-8', status: 'delivered', eventKey: 'd' });
  await applyTracking(tenant._id, { orderNo: 'S-8', awb: 'AWB-8', status: 'in_transit', eventKey: 't' });
  assert.equal((await fresh(tenant._id, 'S-8')).status, 'Delivered');
});

test('a scan for a cancelled AWB creates no new shipment and changes nothing', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-9');
  await Shipment.create({ tenantId: tenant._id, orderNo: 'S-9', channel: 'shopify', courier: 'delhivery', awb: 'OLD-AWB', status: 'cancelled' });
  await applyTracking(tenant._id, { orderNo: 'S-9', awb: 'OLD-AWB', status: 'in_transit', eventKey: 't' });
  assert.equal(await Shipment.countDocuments({ tenantId: tenant._id, orderNo: 'S-9', status: 'booked' }), 0);
  assert.equal((await fresh(tenant._id, 'S-9')).status, 'New');
});

test('an AWB already on another order cannot be reused, and tracking stays on its own order', async () => {
  const tenant = await seller();
  await CourierAccount.create({ tenantId: tenant._id, code: 'bluedart', name: 'Blue Dart', status: 'active', source: 'own' });
  await shopifyOrder(tenant._id, 'S-10');
  await shopifyOrder(tenant._id, 'S-11');
  const shopify = shopifyMock();
  await bookOtherCourier(tenant._id, 'S-10', { courier: 'bluedart', awb: 'BD-1' }, { shopifyCreds: shopCreds, shopifyRequest: shopify.request });
  await assert.rejects(
    bookOtherCourier(tenant._id, 'S-11', { courier: 'bluedart', awb: 'BD-1' }, { shopifyCreds: shopCreds, shopifyRequest: shopify.request }),
    /already/i,
  );
  await Shipment.create({ tenantId: tenant._id, orderNo: 'S-11', channel: 'shopify', courier: 'bluedart', awb: 'BD-1', status: 'booked' });
  await applyTracking(tenant._id, { orderNo: 'S-11', awb: 'BD-1', status: 'in_transit', eventKey: 'x' });
  const mine = await Shipment.findOne({ tenantId: tenant._id, orderNo: 'S-11' });
  const other = await Shipment.findOne({ tenantId: tenant._id, orderNo: 'S-10' });
  assert.equal(mine.trackingEvents.length, 1);
  assert.equal(other.trackingEvents.length, 0);
});

test('no label is booked for a cancelled order', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-12', { status: 'Cancelled' });
  const delhivery = delhiveryMock();
  await assert.rejects(bookShopify(tenant._id, 'S-12', deps(delhivery, shopifyMock())), /Cancelled/);
  assert.equal(delhivery.calls.length, 0);
});

test('an order with a booked AWB cannot be cancelled or reopened by hand until the label is cancelled', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-13');
  await bookShopify(tenant._id, 'S-13', deps(delhiveryMock(), shopifyMock()));
  const order = await fresh(tenant._id, 'S-13');
  await assert.rejects(assertStatusChange(tenant._id, order, 'Cancelled'), /label/i);
  await assert.rejects(assertStatusChange(tenant._id, order, 'New'), /label/i);
  await shopifyOrder(tenant._id, 'S-14', { status: 'Delivered', pickedUpAt: new Date() });
  await assert.rejects(assertStatusChange(tenant._id, await fresh(tenant._id, 'S-14'), 'New'), /left the warehouse/i);
});

test('an Amazon label cannot be cancelled after pickup', async () => {
  const tenant = await seller();
  await Order.create({ tenantId: tenant._id, orderNo: 'AMZ-1', channel: 'Amazon', status: 'Ready to Ship', awb: 'TBA1', pickedUpAt: new Date(), items: [{ sku: 'K', qty: 1 }] });
  await Shipment.create({ tenantId: tenant._id, orderNo: 'AMZ-1', channel: 'amazon', courier: 'amazon', awb: 'TBA1', status: 'booked' });
  await assert.rejects(cancelAmazonLabel(tenant._id, 'AMZ-1'), /picked up/i);
  assert.equal((await Shipment.findOne({ tenantId: tenant._id, orderNo: 'AMZ-1' })).status, 'booked');
});

test('NDR cannot be turned into RTO for a delivered order', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-15', { status: 'Delivered', awb: 'AWB-15' });
  await NdrCase.create({ tenantId: tenant._id, orderNo: 'S-15', awb: 'AWB-15', status: 'open' });
  await assert.rejects(convertNdrToRto(tenant._id, 'S-15'), /delivered/i);
  assert.equal((await fresh(tenant._id, 'S-15')).channelStatus || '', '');
});

test('two hand-over clicks at once put an order on one manifest only', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'S-16', { status: 'Dispatched', awb: 'AWB-16', courier: 'Delhivery', labelGeneratedAt: new Date() });
  await Promise.allSettled([handOver(tenant._id, null, ['S-16']), handOver(tenant._id, null, ['S-16'])]);
  const manifests = await HandoverManifest.find({ tenantId: tenant._id }).lean();
  assert.equal(manifests.reduce((sum, row) => sum + row.rows.filter((r) => r.orderNo === 'S-16').length, 0), 1);
});
