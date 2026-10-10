process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Warehouse = require('../src/models/Warehouse');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const Inventory = require('../src/models/Inventory');
const InventoryLedger = require('../src/models/InventoryLedger');
const Shipment = require('../src/models/Shipment');
const CustomerReturn = require('../src/models/CustomerReturn');
const { stockIn } = require('../src/services/inventory.service');
const { applyTracking } = require('../src/services/tracking.service');
const { receiveReturn } = require('../src/services/returnsFlow.service');
const { bookShopify, cancelShopifyLabel, bookMarketplace } = require('../src/services/ship.service');
const delhivery = require('../src/adapters/couriers/delhivery');
const shopify = require('../src/adapters/shopify');
const amazon = require('../src/adapters/amazon');
const myntra = require('../src/adapters/myntra');
const { pingChannel } = require('../src/services/channelPing.service');

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
const delhiveryCreds = { apiToken: 'dlv-test', pickupWarehouse: 'WH-001', clientName: 'Pack shop', apiMode: 'live' };

function delhiveryMock() {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes('pin-codes')) {
      return { status: 200, text: JSON.stringify({ delivery_codes: [{ postal_code: { pre_paid: 'Y', cash: 'Y' } }] }) };
    }
    if (url.includes('/api/cmu/create.json')) {
      return { status: 200, text: JSON.stringify({ packages: [{ waybill: 'AWB-SELLER-1', status: 'Success' }] }) };
    }
    if (url.includes('packing_slip')) return { status: 200, text: '%PDF-1.4 label' };
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

function watchDelhivery() {
  const names = ['serviceable', 'book', 'bookReturn', 'labelPdf', 'requestPickup', 'cancelAwb', 'trackShipment', 'ndrAction'];
  const originals = {};
  let calls = 0;
  for (const name of names) {
    originals[name] = delhivery[name];
    delhivery[name] = async (...args) => {
      calls += 1;
      return originals[name](...args);
    };
  }
  return {
    count: () => calls,
    restore() {
      for (const name of names) delhivery[name] = originals[name];
    },
  };
}

function blockSockets() {
  const originalRequest = https.request;
  const originalFetch = global.fetch;
  const calls = [];
  https.request = (options) => {
    const host = typeof options === 'string' ? options : (options?.hostname || options?.host || '');
    calls.push(String(host));
    const req = new (require('events').EventEmitter)();
    req.end = () => {};
    req.write = () => {};
    req.destroy = () => {};
    req.setTimeout = () => req;
    process.nextTick(() => req.emit('error', new Error('live socket blocked in test')));
    return req;
  };
  global.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('live socket blocked in test');
  };
  return {
    calls,
    restore() {
      https.request = originalRequest;
      global.fetch = originalFetch;
    },
  };
}

async function seller() {
  const tenant = await Tenant.create({
    name: 'Ship audit',
    slug: `ship-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: 'merchant',
  });
  await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Pickup',
    type: 'physical',
    isPickup: true,
    status: 'active',
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
    address: 'Workshop lane 302001',
    externalOrderId: `gid-${orderNo}`,
    items: [{ name: 'Kurta', sku: 'KURTA-RED-L', qty: 1 }],
    source: 'manual',
  });
}

test('a Shopify order books the seller Delhivery AWB', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'SHP-OWN');
  const courier = delhiveryMock();
  const shop = shopifyMock();
  const shipment = await bookShopify(tenant._id, 'SHP-OWN', {
    delhiveryCreds,
    delhiveryRequest: courier.request,
    shopifyCreds: shopCreds,
    shopifyRequest: shop.request,
  });
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-OWN' });
  assert.equal(shipment.courier, 'delhivery');
  assert.equal(shipment.awb, 'AWB-SELLER-1');
  assert.equal(order.courier, 'Delhivery');
  assert.equal(order.awb, 'AWB-SELLER-1');
  const fulfill = shop.calls.find((call) => String(call.url).endsWith('/fulfillments.json'));
  assert.equal(fulfill.body.fulfillment.tracking_info.number, 'AWB-SELLER-1');
  assert.equal(fulfill.body.fulfillment.tracking_info.company, 'Delhivery');
});

test('Amazon and Myntra ship on the marketplace courier and never call Delhivery', async () => {
  const tenant = await seller();
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'AMZ-MKT',
    channel: 'Amazon',
    externalOrderId: '902-9',
    source: 'channel_api',
  });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'MYN-MKT',
    channel: 'Myntra',
    externalOrderId: 'SO-9',
    source: 'channel_api',
    channelLines: [{ sellerOrderId: 'SO-9', packetId: 'PKT-9' }],
  });
  const watched = watchDelhivery();
  const sockets = blockSockets();
  try {
    const amazonShipment = await bookMarketplace(tenant._id, 'AMZ-MKT', {
      amazonCreds: { sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's', apiMode: 'live' },
      amazonRequest: async (method, url) => {
        if (String(url).includes('/auth/o2/token')) return { status: 200, text: JSON.stringify({ access_token: 'tok' }) };
        return { status: 200, text: JSON.stringify({ trackingDetails: { trackingId: 'AMZ-AWB-9' } }) };
      },
    });
    const myntraShipment = await bookMarketplace(tenant._id, 'MYN-MKT', {
      myntraCreds: { merchantId: 'M1', secretKey: 'S1', storeId: 'STORE1', apiMode: 'live' },
      myntraClient: { readyToDispatch: async () => ({ trackingNumber: 'MYN-AWB-9' }) },
    });
    assert.equal(watched.count(), 0);
    assert.equal(sockets.calls.length, 0);
    assert.equal(amazonShipment.courier, 'amazon');
    assert.equal(amazonShipment.awb, 'AMZ-AWB-9');
    assert.equal(myntraShipment.courier, 'myntra');
    assert.equal(myntraShipment.awb, 'MYN-AWB-9');
  } finally {
    watched.restore();
    sockets.restore();
  }
});

test('cancelling a Shopify label returns the order to unfulfilled', async () => {
  const tenant = await seller();
  await shopifyOrder(tenant._id, 'SHP-CANCEL');
  const courier = delhiveryMock();
  const shop = shopifyMock();
  const deps = {
    delhiveryCreds,
    delhiveryRequest: courier.request,
    shopifyCreds: shopCreds,
    shopifyRequest: shop.request,
  };
  await bookShopify(tenant._id, 'SHP-CANCEL', deps);
  await cancelShopifyLabel(tenant._id, 'SHP-CANCEL', { releaseReserve: false, deps });
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-CANCEL' });
  const shipment = await Shipment.findOne({ tenantId: tenant._id, orderNo: 'SHP-CANCEL' });
  assert.equal(order.status, 'New');
  assert.equal(order.awb, '');
  assert.equal(shipment.status, 'cancelled');
  assert.equal(shop.calls.some((call) => String(call.url).includes('/fulfillments/88/cancel.json')), true);
  assert.equal(courier.calls.some((call) => String(call.url).includes('/api/p/edit')), true);
});

test('NDR then RTO then Return Received restocks once when the receipt is replayed', async () => {
  const tenant = await seller();
  const sku = await MasterSku.create({ tenantId: tenant._id, code: 'KURTA-RTO', name: 'Kurta' });
  await SkuMapping.create({
    tenantId: tenant._id,
    masterSkuId: sku._id,
    channel: 'shopify',
    channelProductId: 'p',
    channelVariantId: 'v',
    channelSkuCode: 'KURTA-RTO',
    channelSkuCodeNorm: 'kurta-rto',
    syncStatus: 'synced',
  });
  const warehouse = await Warehouse.findOne({ tenantId: tenant._id, code: 'WH-001' });
  await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: warehouse._id, qty: 1, reason: 'opening' });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-RTO-ONCE',
    channel: 'Shopify',
    status: 'Dispatched',
    awb: 'AWB-RTO-ONCE',
    courier: 'Delhivery',
    source: 'manual',
    items: [{ sku: 'KURTA-RTO', name: 'Kurta', qty: 1 }],
  });
  await applyTracking(tenant._id, { orderNo: 'SHP-RTO-ONCE', awb: 'AWB-RTO-ONCE', status: 'ndr', detail: 'Attempt 1', eventKey: 'n1' });
  await applyTracking(tenant._id, { orderNo: 'SHP-RTO-ONCE', awb: 'AWB-RTO-ONCE', status: 'ndr', detail: 'Attempt 2', eventKey: 'n2' });
  await applyTracking(tenant._id, { orderNo: 'SHP-RTO-ONCE', awb: 'AWB-RTO-ONCE', status: 'ndr', detail: 'Attempt 3', eventKey: 'n3' });
  await CustomerReturn.create({
    tenantId: tenant._id,
    returnNo: 'RET-RTO-ONCE',
    orderNo: 'SHP-RTO-ONCE',
    channel: 'Shopify',
    status: 'Approved',
    items: [{ sku: 'KURTA-RTO', qty: 1 }],
  });
  await receiveReturn(String(tenant._id), null, 'RET-RTO-ONCE', { destination: 'All', action: 'restock' });
  await receiveReturn(String(tenant._id), null, 'RET-RTO-ONCE', { destination: 'All', action: 'restock' });
  await receiveReturn(String(tenant._id), null, 'RET-RTO-ONCE', { destination: 'All', action: 'restock' });
  const balance = await Inventory.findOne({ tenantId: tenant._id, masterSkuId: sku._id, warehouseId: warehouse._id });
  const rtoRows = await InventoryLedger.countDocuments({ tenantId: tenant._id, referenceId: 'SHP-RTO-ONCE', movementType: 'rto_restock' });
  const returnRows = await InventoryLedger.countDocuments({ tenantId: tenant._id, referenceId: 'RET-RTO-ONCE', movementType: 'return_restock' });
  assert.equal(balance.physicalQty, 2);
  assert.equal(rtoRows, 1);
  assert.equal(returnRows, 0);
  const saved = await CustomerReturn.findOne({ tenantId: tenant._id, returnNo: 'RET-RTO-ONCE' });
  assert.equal(saved.status, 'Completed');
});

test('a live courier or marketplace socket opens only when apiMode is live', async () => {
  const sockets = blockSockets();
  const amazonCreds = { sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's' };
  const myntraCreds = { merchantId: 'M1', secretKey: 'S1', storeId: 'STORE1' };
  const shop = { shopUrl: 'shop.example', adminToken: 'shpat_test' };
  const courier = { apiToken: 'dlv-test', pickupWarehouse: 'WH-001' };
  try {
    await assert.rejects(
      () => delhivery.book(courier, { name: 'A', address: 'Lane', pincode: '302001', orderNo: '1', paymentMode: 'Prepaid' }),
      /apiMode|Live API/,
    );
    await assert.rejects(
      () => amazon.confirmShipment(amazonCreds, { amazonOrderId: '902-1' }),
      /apiMode|Live API/,
    );
    await assert.rejects(
      () => myntra.shipOrder(myntraCreds, { sellerOrderId: 'SO-1', packetId: 'PKT-1' }),
      /apiMode|Live API/,
    );
    await assert.rejects(
      () => shopify.fulfillOrder(shop, { orderId: '1', trackingNumber: 'AWB' }),
      /apiMode|Live API/,
    );
    await assert.rejects(
      () => shopify.pullOrders(shop),
      /apiMode|Live API/,
    );
    const shopPing = await pingChannel('shopify', shop);
    const myntraPing = await pingChannel('myntra', myntraCreds);
    const amazonPing = await pingChannel('amazon', amazonCreds);
    assert.match(`${shopPing.message} ${myntraPing.message} ${amazonPing.message}`, /apiMode|Live API/);
    assert.equal(sockets.calls.length, 0);

    await assert.rejects(
      () => delhivery.book({ ...courier, apiMode: 'live' }, { name: 'A', address: 'Lane', pincode: '302001', orderNo: '1', paymentMode: 'Prepaid' }),
      /blocked in test|Delhivery/,
    );
    assert.ok(sockets.calls.length > 0);
  } finally {
    sockets.restore();
  }
});
