const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const Warehouse = require('../src/models/Warehouse');
const WarehouseLocationMap = require('../src/models/WarehouseLocationMap');
const SkuMapping = require('../src/models/SkuMapping');
const Order = require('../src/models/Order');
const Inventory = require('../src/models/Inventory');
const InventoryLedger = require('../src/models/InventoryLedger');
const InventoryReservation = require('../src/models/InventoryReservation');
const IntegrationJob = require('../src/models/IntegrationJob');
const CustomerReturn = require('../src/models/CustomerReturn');
const shopify = require('../src/adapters/shopify');
const { stockIn } = require('../src/services/inventory.service');
const { ingestChannelOrders, applyStoredWebhook } = require('../src/services/channelOrder.service');
const { enqueueManual } = require('../src/services/jobQueue.service');
const { upsertConnection } = require('../src/services/channelConnection.service');
const { applyTracking } = require('../src/services/tracking.service');
const { approveReturn } = require('../src/services/returnsFlow.service');

let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

function shopifyOrder(id, sku, qty, extra = {}) {
  return {
    id,
    financial_status: 'paid',
    fulfillment_status: null,
    payment_gateway_names: extra.gateways || ['Cash on Delivery'],
    total_price: '499.00',
    created_at: '2026-10-01T00:00:00.000Z',
    location_id: extra.locationId || '',
    line_items: [{
      title: 'Kurta',
      sku,
      quantity: qty,
      price: '499.00',
      origin_location: extra.locationId ? { id: extra.locationId } : undefined,
    }],
  };
}

async function seller() {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Gap', slug: `gap-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `KURTA-${stamp}`, name: 'Kurta' });
  const physical = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Physical',
    type: 'physical',
    isDefault: true,
    isPickup: true,
    sellOnShopify: true,
    status: 'active',
  });
  const virtual = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-002',
    name: 'Virtual',
    type: 'virtual',
    sellOnShopify: true,
    sellOnAmazon: false,
    sellOnMyntra: false,
    isPickup: false,
    status: 'active',
  });
  await WarehouseLocationMap.create({
    tenantId: tenant._id,
    warehouseId: virtual._id,
    channel: 'shopify',
    externalLocationId: '222',
  });
  await SkuMapping.create({
    tenantId: tenant._id,
    masterSkuId: sku._id,
    channel: 'shopify',
    channelVariantId: `var-${stamp}`,
    channelSkuCode: 'KURTA',
    channelSkuCodeNorm: 'kurta',
    syncStatus: 'synced',
  });
  await stockIn(String(tenant._id), null, {
    masterSkuId: sku._id,
    warehouseId: physical._id,
    qty: 5,
    reason: 'opening',
  });
  await stockIn(String(tenant._id), null, {
    masterSkuId: sku._id,
    warehouseId: virtual._id,
    qty: 2,
    reason: 'virtual',
  });
  return { tenant, sku, physical, virtual };
}

test('Shopify pull maps a COD order without calling the network', async () => {
  let called = 0;
  const orders = await shopify.pullOrders(
    { shopUrl: 'demo.myshopify.com', adminToken: 'token' },
    {
      request: async () => {
        called += 1;
        return {
          status: 200,
          text: JSON.stringify({ orders: [shopifyOrder(9001, 'KURTA', 1)] }),
          headers: {},
        };
      },
    },
  );
  assert.equal(called, 1);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].paymentMode, 'COD');
  assert.equal(orders[0].status, 'New');
  assert.equal(orders[0].items[0].sku, 'KURTA');
  assert.equal(orders[0].sourceOrderData.id, '9001');
});

test('ingest reserves once, adjusts quantity, then releases on cancel', async () => {
  const { tenant } = await seller();
  const id = String(tenant._id);
  const mapped = shopify.mapShopifyOrder(shopifyOrder(11, 'KURTA', 1), {});
  const first = await ingestChannelOrders(id, 'shopify', [mapped]);
  assert.equal(first.created, 1);
  const again = await ingestChannelOrders(id, 'shopify', [mapped]);
  assert.equal(again.unchanged, 1);
  const held = await InventoryReservation.countDocuments({ tenantId: tenant._id, status: 'held' });
  assert.equal(held, 1);
  const ledgers = await InventoryLedger.countDocuments({ tenantId: tenant._id, movementType: 'order_reserve' });
  assert.equal(ledgers, 1);

  const raised = shopify.mapShopifyOrder(shopifyOrder(11, 'KURTA', 2), {});
  await ingestChannelOrders(id, 'shopify', [raised]);
  const hold = await InventoryReservation.findOne({ tenantId: tenant._id, status: 'held' });
  assert.equal(hold.qty, 2);

  const cancelled = shopify.mapShopifyOrder({ ...shopifyOrder(11, 'KURTA', 2), cancelled_at: '2026-10-02T00:00:00.000Z' }, {});
  await ingestChannelOrders(id, 'shopify', [cancelled]);
  const left = await InventoryReservation.countDocuments({ tenantId: tenant._id, status: 'held' });
  assert.equal(left, 0);
  const order = await Order.findOne({ tenantId: tenant._id, externalOrderId: '11' });
  assert.equal(order.status, 'Cancelled');
  assert.equal(order.reserveState, '');
});

test('the second order for the last unit is out of stock and location B uses the virtual warehouse', async () => {
  const { tenant, physical, virtual } = await seller();
  const id = String(tenant._id);
  await Inventory.updateMany(
    { tenantId: tenant._id },
    { $set: { physicalQty: 0, virtualQty: 0, reservedQty: 0 } },
  ).setOptions({ skipTenantFilter: true });
  await Inventory.updateOne({ tenantId: tenant._id, warehouseId: physical._id }, { $set: { physicalQty: 1 } }).setOptions({ skipTenantFilter: true });
  const a = shopify.mapShopifyOrder(shopifyOrder(21, 'KURTA', 1), {});
  const b = shopify.mapShopifyOrder(shopifyOrder(22, 'KURTA', 1), {});
  await ingestChannelOrders(id, 'shopify', [a, b]);
  const first = await Order.findOne({ tenantId: tenant._id, externalOrderId: '21' });
  const second = await Order.findOne({ tenantId: tenant._id, externalOrderId: '22' });
  assert.equal(first.reserveState, 'reserved');
  assert.equal(second.reserveState, 'out_of_stock');
  const reserves = await InventoryLedger.countDocuments({
    tenantId: tenant._id,
    movementType: 'order_reserve',
    referenceId: { $in: ['SHP-21', 'SHP-22'] },
  });
  assert.equal(reserves, 1);

  await Inventory.updateOne(
    { tenantId: tenant._id, warehouseId: virtual._id },
    { $set: { virtualQty: 2, reservedQty: 0 } },
  ).setOptions({ skipTenantFilter: true });
  const located = shopify.mapShopifyOrder(shopifyOrder(23, 'KURTA', 1, { locationId: '222' }), {});
  await ingestChannelOrders(id, 'shopify', [located]);
  const third = await Order.findOne({ tenantId: tenant._id, externalOrderId: '23' });
  assert.equal(third.items[0].fulfilmentSource, 'Virtual');
  assert.equal(third.reserveState, 'reserved');
  const virtualHold = await InventoryReservation.findOne({ tenantId: tenant._id, orderRef: 'SHP-23', status: 'held' });
  assert.equal(String(virtualHold.warehouseId), String(virtual._id));
});

test('a Shopify webhook creates an order only when the payload has line items', async () => {
  const { tenant } = await seller();
  const ignored = await applyStoredWebhook({
    tenantId: tenant._id,
    channel: 'shopify',
    topic: 'orders/create',
    payload: { id: 'evt-crash', topic: 'orders/create' },
  });
  assert.equal(ignored, 'ignored');
  assert.equal(await Order.countDocuments({ tenantId: tenant._id }), 0);

  const applied = await applyStoredWebhook({
    tenantId: tenant._id,
    channel: 'shopify',
    topic: 'orders/create',
    payload: shopifyOrder(31, 'KURTA', 1),
  });
  assert.equal(applied, 'order');
  const order = await Order.findOne({ tenantId: tenant._id, externalOrderId: '31' });
  assert.equal(order.orderNo, 'SHP-31');
  assert.equal(order.reserveState, 'reserved');
});

test('orders pull is refused until the shop URL and admin token are saved', async () => {
  const { tenant } = await seller();
  const id = String(tenant._id);
  await assert.rejects(
    () => enqueueManual(id, null, { channel: 'shopify', jobType: 'orders_pull' }),
    /not pulled|not connected|Shopify/i,
  );
  await upsertConnection(id, null, 'shopify', {
    credentials: { shopUrl: 'demo.myshopify.com', adminToken: 'shpat_test' },
  });
  const job = await enqueueManual(id, null, { channel: 'shopify', jobType: 'orders_pull' });
  assert.equal(job.status, 'queued');
  await IntegrationJob.deleteMany({ tenantId: tenant._id });
});

test('RTO restocks a mapped item once and a return label uses Delhivery only when a token is passed in', async () => {
  const { tenant } = await seller();
  const order = await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-RTO',
    channel: 'Shopify',
    status: 'Dispatched',
    city: 'Jaipur 302001',
    shipState: 'RJ',
    address: 'Warehouse lane',
    items: [{ name: 'Kurta', sku: 'KURTA', qty: 1, price: 499 }],
  });
  await applyTracking(String(tenant._id), { orderNo: order.orderNo, awb: 'AWB1', status: 'rto' });
  await applyTracking(String(tenant._id), { orderNo: order.orderNo, awb: 'AWB1', status: 'rto', eventKey: 'second' });
  const restocks = await InventoryLedger.countDocuments({
    tenantId: tenant._id,
    referenceId: 'SHP-RTO',
    movementType: 'rto_restock',
  });
  assert.equal(restocks, 1);
  const saved = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-RTO' });
  assert.ok(saved.rtoRestockedAt);

  await CustomerReturn.create({
    tenantId: tenant._id,
    returnNo: 'RET-LOCAL',
    orderNo: 'SHP-RTO',
    status: 'Pending',
    items: [{ sku: 'KURTA', qty: 1 }],
  });
  const local = await approveReturn(String(tenant._id), 'RET-LOCAL');
  assert.equal(local.labelAwb, 'RET-RET-LOCAL');

  await CustomerReturn.create({
    tenantId: tenant._id,
    returnNo: 'RET-LIVE',
    orderNo: 'SHP-RTO',
    status: 'Pending',
    items: [{ sku: 'KURTA', qty: 1 }],
  });
  let body = '';
  const booked = await approveReturn(String(tenant._id), 'RET-LIVE', {
    delhiveryCreds: { apiToken: 'token', clientName: 'WH-001', pickupWarehouse: 'WH-001' },
    delhiveryRequest: async (_method, _url, opts) => {
      body = opts.body;
      return { status: 200, text: JSON.stringify({ packages: [{ waybill: 'RETWB1', status: 'Success' }] }) };
    },
  });
  assert.equal(booked.labelAwb, 'RETWB1');
  assert.match(body, /Pickup/);
});
