process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const WarehouseLocationMap = require('../src/models/WarehouseLocationMap');
const InventoryLedger = require('../src/models/InventoryLedger');
const IntegrationJob = require('../src/models/IntegrationJob');
const { stockIn } = require('../src/services/inventory.service');
const { ensureDefaultWarehouses } = require('../src/services/warehouse.service');
const { channelQty, runInventoryJob } = require('../src/services/inventoryPush.service');
const { upsertConnection } = require('../src/services/channelConnection.service');
const { applyTracking, pollDelhivery, reattemptNdr, convertNdrToRto } = require('../src/services/tracking.service');
const { ingestReturns, approveReturn, receiveReturn } = require('../src/services/returnsFlow.service');
const { restockReturn } = require('../src/services/inventory.service');

let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

async function seller(slug) {
  const tenant = await Tenant.create({ name: 'Track shop', slug, kind: 'merchant' });
  const { physical } = await ensureDefaultWarehouses(tenant._id);
  const maps = await WarehouseLocationMap.find({ tenantId: tenant._id, channel: 'shopify' });
  for (const row of maps) {
    row.externalLocationId = String(row.warehouseId) === String(physical._id) ? '111' : '222';
    await row.save();
  }
  return { tenant, physical };
}

test('a delivered scan keeps the same Master Order', async () => {
  const { tenant } = await seller(`track-${Date.now()}`);
  const order = await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-DEL',
    channel: 'Shopify',
    status: 'Dispatched',
    awb: 'AWB-DEL',
    courier: 'Delhivery',
    source: 'manual',
  });
  const before = await Order.countDocuments({ tenantId: tenant._id });
  const result = await pollDelhivery(tenant._id, order.orderNo, {
    delhiveryCreds: { apiToken: 'dlv-test' },
    delhiveryRequest: async () => ({
      status: 200,
      text: JSON.stringify({
        ShipmentData: [{
          Shipment: {
            Status: { Status: 'In Transit' },
            Scans: [
              { ScanDetail: { Scan: 'Picked Up', ScanDateTime: '2026-10-09T10:00:00', Instructions: 'Picked up' } },
              { ScanDetail: { Scan: 'In Transit', ScanDateTime: '2026-10-09T12:00:00', Instructions: 'In transit' } },
              { ScanDetail: { Scan: 'Delivered', ScanDateTime: '2026-10-09T18:00:00', Instructions: 'Delivered' } },
            ],
          },
        }],
      }),
    }),
  });
  const fresh = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-DEL' });
  assert.equal(result.applied, 3);
  assert.equal(String(fresh._id), String(order._id));
  assert.equal(fresh.status, 'Delivered');
  assert.equal(await Order.countDocuments({ tenantId: tenant._id }), before);
});

test('an NDR scan does not create a new order, and reattempt or RTO stays on it', async () => {
  const { tenant } = await seller(`ndr-${Date.now()}`);
  const order = await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-NDR',
    channel: 'Shopify',
    status: 'Dispatched',
    awb: 'AWB-NDR',
    courier: 'Delhivery',
    source: 'manual',
  });
  const before = await Order.countDocuments({ tenantId: tenant._id });
  await applyTracking(tenant._id, {
    orderNo: order.orderNo,
    awb: order.awb,
    status: 'ndr',
    detail: 'Consignee not available',
    attempt: 1,
  });
  assert.equal(await Order.countDocuments({ tenantId: tenant._id }), before);
  const again = await applyTracking(tenant._id, {
    orderNo: order.orderNo,
    awb: order.awb,
    status: 'ndr',
    detail: 'Consignee not available',
    attempt: 1,
  });
  assert.equal(again.duplicate, true);
  const reattempt = await reattemptNdr(tenant._id, order.orderNo, {
    phone: '9000000001',
    address: 'Lane 2',
    deps: {
      delhiveryCreds: { apiToken: 'dlv-test' },
      delhiveryRequest: async (_method, url) => {
        assert.match(url, /\/api\/p\/update/);
        return { status: 200, text: '{}' };
      },
    },
  });
  assert.equal(reattempt.createdOrder, false);
  assert.equal(reattempt.orderId, String(order._id));
  assert.equal(reattempt.ndr.status, 'reattempt');
  const rto = await convertNdrToRto(tenant._id, order.orderNo);
  assert.equal(rto.createdOrder, false);
  assert.equal(rto.order.channelStatus, 'RTO');
  assert.equal(String(rto.order._id), String(order._id));
  assert.equal(await Order.countDocuments({ tenantId: tenant._id }), before);
});

test('return receive restocks WH-001 and raises channel ATS for the chosen channels', async () => {
  const { tenant, physical } = await seller(`ret-${Date.now()}`);
  const sku = await MasterSku.create({ tenantId: tenant._id, code: 'KURTA-RED-L', name: 'Kurta' });
  for (const channel of ['shopify', 'amazon', 'myntra']) {
    await SkuMapping.create({
      tenantId: tenant._id,
      masterSkuId: sku._id,
      channel,
      channelProductId: `${channel}-p`,
      channelVariantId: `${channel}-v`,
      channelSkuCode: 'KURTA-RED-L',
      channelSkuCodeNorm: 'kurta-red-l',
      syncStatus: 'synced',
    });
  }
  await upsertConnection(tenant._id, null, 'shopify', { credentials: { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' } });
  await upsertConnection(tenant._id, null, 'amazon', {
    credentials: { sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's', apiMode: 'live' },
  });
  await upsertConnection(tenant._id, null, 'myntra', {
    credentials: { merchantId: 'M1', secretKey: 'S1', storeId: 'STORE1', apiMode: 'live' },
  });
  await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: physical._id, qty: 4, reason: 'opening' });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-RET',
    channel: 'Shopify',
    status: 'Delivered',
    source: 'manual',
    items: [{ sku: 'KURTA-RED-L', name: 'Kurta', qty: 1 }],
  });
  const beforeOrders = await Order.countDocuments({ tenantId: tenant._id });
  const ingested = await ingestReturns(tenant._id, [{
    returnNo: 'RET-1',
    orderNo: 'SHP-RET',
    channel: 'Shopify',
    reason: 'Size',
    items: [{ sku: 'KURTA-RED-L', qty: 1 }],
  }]);
  assert.equal(ingested.createdOrder, false);
  assert.equal(await Order.countDocuments({ tenantId: tenant._id }), beforeOrders);
  await approveReturn(tenant._id, 'RET-1');
  await receiveReturn(String(tenant._id), null, 'RET-1', { destination: 'All', action: 'restock' });
  const qty = await channelQty(tenant._id, sku._id);
  assert.equal(qty.amazon, 5);
  const primary = qty.shopify.find((row) => row.locationId === '111');
  assert.equal(primary.available, 5);

  const shopifyCalls = [];
  const amazonCalls = [];
  const myntraItems = [];
  const jobs = await IntegrationJob.find({ tenantId: tenant._id, jobType: 'inventory_push', status: 'queued' });
  assert.equal(jobs.length, 3);
  for (const job of jobs) {
    await runInventoryJob(job, {
      shopifyRequest: async (method, url, opts = {}) => {
        shopifyCalls.push({ method, url, body: opts.body });
        if (String(url).includes('/variants/')) return { status: 200, text: JSON.stringify({ variant: { inventory_item_id: 55 } }) };
        return { status: 200, text: '{}' };
      },
      amazonRequest: async (method, url, opts = {}) => {
        amazonCalls.push({ method, url, body: opts.body });
        if (String(url).includes('/auth/o2/token')) return { status: 200, text: JSON.stringify({ access_token: 'tok' }) };
        return { status: 200, text: '{}' };
      },
      myntraClient: { updateInventory: async (items) => { myntraItems.push(...items); return []; } },
    });
  }
  const set = shopifyCalls.find((call) => String(call.url).includes('/inventory_levels/set') && call.body.location_id === 111);
  assert.equal(set.body.available, 5);
  const patch = amazonCalls.find((call) => call.method === 'PATCH');
  assert.equal(patch.body.patches[0].value[0].quantity, 5);
  assert.deepEqual(myntraItems, [{ sku: 'KURTA-RED-L', quantity: 5 }]);
  await IntegrationJob.updateMany({ tenantId: tenant._id }, { $set: { status: 'success' } });

  await restockReturn(String(tenant._id), null, {
    items: [{ sku: 'KURTA-RED-L', qty: 1 }],
    referenceId: 'RTO-1',
    destination: 'Amazon',
    movementType: 'rto_restock',
  });
  const ledger = await InventoryLedger.findOne({ tenantId: tenant._id, referenceId: 'RTO-1' });
  assert.equal(ledger.movementType, 'rto_restock');
  const pushed = await IntegrationJob.find({ tenantId: tenant._id, jobType: 'inventory_push', status: 'queued' });
  assert.deepEqual(pushed.map((job) => job.channel), ['amazon']);
  const isolated = await channelQty(tenant._id, sku._id);
  assert.equal(isolated.amazon, 6);
  assert.equal(isolated.myntra, 5);
  assert.equal(isolated.shopify.find((row) => row.locationId === '111').available, 5);
  assert.equal(isolated.shopify.find((row) => row.locationId === '222').available, 0);
});

test('a return label calls Delhivery only when token, pickup warehouse, and pincode are present', async () => {
  const { tenant } = await seller(`label-${Date.now()}`);
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-LAB',
    channel: 'Shopify',
    status: 'Delivered',
    city: 'Jaipur',
    address: 'Warehouse lane 302001',
    items: [{ sku: 'KURTA', qty: 1 }],
  });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-NOPIN',
    channel: 'Shopify',
    status: 'Delivered',
    city: 'Jaipur',
    address: 'No pin here',
    items: [{ sku: 'KURTA', qty: 1 }],
  });
  await ingestReturns(tenant._id, [
    { returnNo: 'RET-NOWARE', orderNo: 'SHP-LAB', items: [{ sku: 'KURTA', qty: 1 }] },
    { returnNo: 'RET-NOPIN', orderNo: 'SHP-NOPIN', items: [{ sku: 'KURTA', qty: 1 }] },
    { returnNo: 'RET-LIVE', orderNo: 'SHP-LAB', items: [{ sku: 'KURTA', qty: 1 }] },
  ]);
  let calls = 0;
  const noWarehouse = await approveReturn(tenant._id, 'RET-NOWARE', {
    delhiveryCreds: { apiToken: 'token' },
    delhiveryRequest: async () => { calls += 1; return { status: 200, text: '{}' }; },
  });
  assert.equal(noWarehouse.labelAwb, 'RET-RET-NOWARE');
  const noPin = await approveReturn(tenant._id, 'RET-NOPIN', {
    delhiveryCreds: { apiToken: 'token', pickupWarehouse: 'WH-001' },
    delhiveryRequest: async () => { calls += 1; return { status: 200, text: '{}' }; },
  });
  assert.equal(noPin.labelAwb, 'RET-RET-NOPIN');
  assert.equal(calls, 0);

  let body = '';
  const booked = await approveReturn(tenant._id, 'RET-LIVE', {
    delhiveryCreds: { apiToken: 'token', pickupWarehouse: 'WH-001' },
    delhiveryRequest: async (_method, _url, opts) => {
      calls += 1;
      body = opts.body;
      return { status: 200, text: JSON.stringify({ packages: [{ waybill: 'RETWB9', status: 'Success' }] }) };
    },
  });
  assert.equal(booked.labelAwb, 'RETWB9');
  assert.equal(calls, 1);
  assert.match(String(body), /WH-001/);
});
