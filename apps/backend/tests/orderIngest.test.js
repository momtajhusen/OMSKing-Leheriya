const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const Warehouse = require('../src/models/Warehouse');
const WarehouseLocationMap = require('../src/models/WarehouseLocationMap');
const SkuMapping = require('../src/models/SkuMapping');
const Order = require('../src/models/Order');
const InventoryLedger = require('../src/models/InventoryLedger');
const InventoryReservation = require('../src/models/InventoryReservation');
const shopify = require('../src/adapters/shopify');
const { als } = require('../src/lib/tenantContext');
const { stockIn } = require('../src/services/inventory.service');
const { ingestChannelOrders } = require('../src/services/channelOrder.service');
const { listOrders } = require('../src/controllers/orders.controller');

let replSet;

function shopifyOrder(id, { cancelled = false, fulfillment = null, total = '100.00' } = {}) {
  return shopify.mapShopifyOrder({
    id,
    created_at: '2026-08-01T10:00:00Z',
    cancelled_at: cancelled ? '2026-08-02T10:00:00Z' : null,
    financial_status: 'paid',
    fulfillment_status: fulfillment,
    payment_gateway_names: ['UPI'],
    total_price: total,
    shipping_address: { name: 'Asha Mehta', address1: '12 MG Road', city: 'Surat', province: 'GJ', zip: '395003', phone: '9811100001' },
    line_items: [{
      id: 1, sku: 'KURTA', title: 'Kurta', quantity: 1, price: total,
    }],
  }, {});
}

async function seller() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await Tenant.create({ name: 'Ingest', slug: `ingest-${stamp}`, kind: 'merchant' });
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
  return { tenant, sku, physical };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function ordersFor(tenant, query) {
  const res = fakeRes();
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false }, () => listOrders({
    tenantId: tenant._id,
    skipTenantFilter: false,
    query,
  }, res));
  return res.body?.data || [];
}

async function holds(tenantId, orderNo) {
  return InventoryReservation.countDocuments({ tenantId, orderRef: orderNo, status: 'held' });
}

async function reserveRows(tenantId, orderNo) {
  return InventoryLedger.countDocuments({ tenantId, referenceId: orderNo, movementType: 'order_reserve' });
}

describe('order ingestion', () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Order.syncIndexes();
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  it('indexes company + channel + channel order id', async () => {
    const indexes = await Order.collection.indexes();
    const hit = indexes.find((row) => (
      row.key?.tenantId === 1 && row.key?.channel === 1 && row.key?.externalOrderId === 1
    ));
    assert.ok(hit, 'missing unique index on tenantId + channel + externalOrderId');
    assert.equal(hit.unique, true);
    assert.ok(hit.partialFilterExpression, 'blank channel order ids must stay out of the unique index');
    const tenant = await Tenant.create({ name: 'Blank', slug: `blank-${Date.now()}`, kind: 'merchant' });
    await Order.create({ tenantId: tenant._id, orderNo: 'MAN-1', channel: 'Shopify', status: 'New', total: 1, source: 'manual', externalOrderId: '' });
    await Order.create({ tenantId: tenant._id, orderNo: 'MAN-2', channel: 'Shopify', status: 'New', total: 1, source: 'manual', externalOrderId: '' });
    assert.equal(await Order.countDocuments({ tenantId: tenant._id, externalOrderId: '' }), 2);
  });

  it('keeps the Shopify delivery pincode and backfills an order saved without one', async () => {
    const mapped = shopify.mapShopifyOrder({
      id: 5501,
      financial_status: 'paid',
      line_items: [{ sku: 'KURTA', title: 'Kurta', quantity: 1, price: '100.00' }],
      shipping_address: {
        address1: '1743-C, VISHNU GARDEN',
        address2: 'NEAR GURUDWARA',
        city: 'YAMUNANAGAR',
        province: 'Haryana',
        zip: '135001',
      },
    }, {});
    assert.match(`${mapped.address} ${mapped.city}`, /\b135001\b/);
    assert.match(mapped.address, /NEAR GURUDWARA/);
    const { tenant } = await seller();
    await Order.create({
      tenantId: tenant._id,
      orderNo: 'SHP-5501',
      channel: 'Shopify',
      externalOrderId: '5501',
      address: '1743-C, VISHNU GARDEN, NEAR GURUDWARA',
      city: 'YAMUNANAGAR',
      status: 'New',
      source: 'channel_api',
      items: [{ sku: 'KURTA', name: 'Kurta', qty: 1 }],
    });
    await ingestChannelOrders(String(tenant._id), 'shopify', [mapped]);
    const saved = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-5501' }).setOptions({ skipTenantFilter: true });
    assert.match(`${saved.address} ${saved.city}`, /\b135001\b/);
  });

  it('keeps the Shopify customer email and backfills an order saved without one', async () => {
    const line = [{ sku: 'KURTA', title: 'Kurta', quantity: 1, price: '100.00' }];
    assert.equal(shopify.mapShopifyOrder({ id: 5601, email: 'a@x.in', line_items: line }, {}).email, 'a@x.in');
    assert.equal(shopify.mapShopifyOrder({ id: 5602, contact_email: 'b@x.in', line_items: line }, {}).email, 'b@x.in');
    assert.equal(shopify.mapShopifyOrder({ id: 5603, customer: { email: 'c@x.in' }, line_items: line }, {}).email, 'c@x.in');
    const { tenant } = await seller();
    await Order.create({
      tenantId: tenant._id,
      orderNo: 'SHP-5604',
      channel: 'Shopify',
      externalOrderId: '5604',
      email: '',
      status: 'New',
      source: 'channel_api',
      items: [{ sku: 'KURTA', name: 'Kurta', qty: 1 }],
    });
    const mapped = shopify.mapShopifyOrder({ id: 5604, customer: { email: 'narvekar@example.com' }, line_items: line }, {});
    await ingestChannelOrders(String(tenant._id), 'shopify', [mapped]);
    const row = (await ordersFor(tenant, { status: 'all' })).find((order) => order.id === 'SHP-5604');
    assert.equal(row.email, 'narvekar@example.com');
  });

  it('keeps the Shopify product vendor on each order line without assigning it', async () => {
    const { tenant } = await seller();
    const mapped = shopify.mapShopifyOrder({
      id: 4406,
      financial_status: 'paid',
      line_items: [{ sku: 'KURTA', title: 'Kurta', quantity: 1, price: '100.00', vendor: 'Jaipur Prints' }],
    }, {});
    assert.equal(mapped.items[0].vendor, 'Jaipur Prints');
    await ingestChannelOrders(String(tenant._id), 'shopify', [mapped]);
    const row = (await ordersFor(tenant, { status: 'all' })).find((order) => order.id === 'SHP-4406');
    assert.equal(row.items[0].vendor, 'Jaipur Prints');
    assert.equal(row.subOrders[0].assignedVendor, '');
  });

  it('creates the master SKU from the order line when a new Shopify SKU arrives before the catalog pull', async () => {
    const { tenant } = await seller();
    const tenantId = String(tenant._id);
    const mapped = shopify.mapShopifyOrder({
      id: 4407,
      financial_status: 'paid',
      line_items: [{ sku: 'LEH-AD-21122', title: 'Bandhani Dupatta', quantity: 1, price: '3499.00', variant_id: 555, product_id: 777 }],
    }, {});
    await ingestChannelOrders(tenantId, 'shopify', [mapped]);

    const master = await MasterSku.findOne({ tenantId: tenant._id, code: 'LEH-AD-21122' }).setOptions({ skipTenantFilter: true });
    assert.ok(master, 'master SKU is created on the first order');
    const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-4407' }).setOptions({ skipTenantFilter: true });
    assert.equal(String(order.items[0].masterSkuId), String(master._id));
    const row = (await ordersFor(tenant, { status: 'all' })).find((one) => one.id === 'SHP-4407');
    assert.notEqual(row.status, 'Unfulfillable');

    const { importChannel } = require('../src/services/catalogMapping.service');
    const pull = await importChannel(tenantId, null, 'shopify', [
      { channelSkuCode: 'LEH-AD-21122', channelVariantId: '555', channelProductId: '777', title: 'Bandhani Dupatta', price: 3499 },
    ]);
    assert.equal(pull.exists, 1);
    assert.equal(await MasterSku.countDocuments({ tenantId: tenant._id, code: /^LEH-AD-21122/ }).setOptions({ skipTenantFilter: true }), 1);
  });

  it('copies the master SKU GST rate and HSN onto a Shopify order line', async () => {
    const { tenant, sku } = await seller();
    await MasterSku.updateOne({ _id: sku._id }, { $set: { hsnCode: '620443', gstRatePercent: 5 } }).setOptions({ skipTenantFilter: true });
    await ingestChannelOrders(String(tenant._id), 'shopify', [shopifyOrder(4405)]);
    const saved = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-4405' }).setOptions({ skipTenantFilter: true });
    assert.equal(saved.items[0].gst, 5);
    assert.equal(saved.items[0].hsn, '620443');
  });

  it('delivers the same channel order twice as one Master Order and one stock lock', async () => {
    const { tenant } = await seller();
    const id = String(tenant._id);
    const first = await ingestChannelOrders(id, 'shopify', [shopifyOrder(4401)]);
    const second = await ingestChannelOrders(id, 'shopify', [shopifyOrder(4401)]);
    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(await Order.countDocuments({ tenantId: tenant._id, channel: 'Shopify', externalOrderId: '4401' }), 1);
    assert.equal(await holds(tenant._id, 'SHP-4401'), 1);
    assert.equal(await reserveRows(tenant._id, 'SHP-4401'), 1);
  });

  it('keeps one Master Order and one stock lock when the same order arrives concurrently', async () => {
    const { tenant } = await seller();
    const id = String(tenant._id);
    const payload = [shopifyOrder(4402)];
    const results = await Promise.all([
      ingestChannelOrders(id, 'shopify', payload),
      ingestChannelOrders(id, 'shopify', payload),
    ]);
    const created = results.reduce((sum, row) => sum + row.created, 0);
    assert.equal(created, 1);
    assert.equal(await Order.countDocuments({ tenantId: tenant._id, externalOrderId: '4402' }), 1);
    assert.equal(await holds(tenant._id, 'SHP-4402'), 1);
    assert.equal(await reserveRows(tenant._id, 'SHP-4402'), 1);
  });

  it('lists cancelled orders on All Orders and returns an unfulfilled order to New', async () => {
    const { tenant } = await seller();
    const id = String(tenant._id);
    await ingestChannelOrders(id, 'shopify', [shopifyOrder(4403, { cancelled: true, total: '500.00' })]);
    await ingestChannelOrders(id, 'shopify', [shopifyOrder(4404, { total: '100.00' })]);
    const all = await ordersFor(tenant, { status: 'all' });
    const numbers = all.map((row) => row.id);
    assert.ok(numbers.includes('SHP-4403'));
    assert.ok(numbers.includes('SHP-4404'));
    const net = all.filter((row) => row.status !== 'Cancelled').reduce((sum, row) => sum + Number(row.total || 0), 0);
    assert.equal(net, 100);
    const cancelledTab = await ordersFor(tenant, { status: 'Cancelled' });
    assert.ok(cancelledTab.some((row) => row.id === 'SHP-4403'));

    await ingestChannelOrders(id, 'shopify', [shopifyOrder(4403, { cancelled: false, fulfillment: null, total: '500.00' })]);
    const reopened = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-4403' }).setOptions({ skipTenantFilter: true });
    assert.equal(reopened.status, 'New');
    const fresh = await ordersFor(tenant, { status: 'New' });
    assert.ok(fresh.some((row) => row.id === 'SHP-4403'));
  });

  it('shows the courier and AWB from a Shopify fulfilment made outside OMSKing', async () => {
    const { tenant } = await seller();
    const id = String(tenant._id);
    await ingestChannelOrders(id, 'shopify', [shopifyOrder(4408)]);
    const raw = (fulfillments) => shopify.mapShopifyOrder({
      id: 4408,
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      line_items: [{ sku: 'KURTA', title: 'Kurta', quantity: 1, price: '100.00' }],
      fulfillments,
    }, {});
    const mapped = raw([
      { id: 1, status: 'cancelled', tracking_company: 'Bluedart', tracking_number: 'OLD-1' },
      { id: 2, status: 'success', tracking_company: 'Delhivery', tracking_number: '36925810147' },
    ]);
    assert.equal(mapped.courier, 'Delhivery');
    assert.equal(mapped.awb, '36925810147');
    await ingestChannelOrders(id, 'shopify', [mapped]);
    const row = (await ordersFor(tenant, { status: 'all' })).find((order) => order.id === 'SHP-4408');
    assert.equal(row.status, 'Dispatched');
    assert.equal(row.courier, 'Delhivery');
    assert.equal(row.awb, '36925810147');

    await ingestChannelOrders(id, 'shopify', [shopifyOrder(4409)]);
    await Order.updateOne({ tenantId: tenant._id, orderNo: 'SHP-4409' }, { $set: { courier: 'Delhivery', awb: 'OMS-AWB-1' } }).setOptions({ skipTenantFilter: true });
    const other = raw([{ id: 3, status: 'success', tracking_company: 'Xpressbees', tracking_number: 'XB-9' }]);
    other.externalOrderId = '4409';
    await ingestChannelOrders(id, 'shopify', [other]);
    const kept = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-4409' }).setOptions({ skipTenantFilter: true });
    assert.equal(kept.awb, 'OMS-AWB-1', 'an AWB stamped by an OMSKing label is not replaced');
    assert.equal(kept.courier, 'Delhivery');
  });

  it('shows the original Shopify, Amazon and Myntra order id on the list and finds it in search', async () => {
    const { tenant } = await seller();
    const id = String(tenant._id);
    await Order.create({
      tenantId: tenant._id,
      orderNo: 'SHP-19028899266653',
      channel: 'Shopify',
      externalOrderId: '19028899266653',
      status: 'New',
      source: 'channel_api',
      items: [{ sku: 'KURTA', name: 'Kurta', qty: 1 }],
    });
    const named = shopify.mapShopifyOrder({
      id: 19028899266653,
      name: '#68762-LEH',
      order_number: 68762,
      financial_status: 'paid',
      line_items: [{ sku: 'KURTA', title: 'Kurta', quantity: 1, price: '100.00' }],
    }, {});
    assert.equal(named.channelOrderNo, '#68762-LEH');
    await ingestChannelOrders(id, 'shopify', [named]);
    await Order.create({
      tenantId: tenant._id,
      orderNo: 'SHP-18966197174365',
      channel: 'Shopify',
      externalOrderId: '18966197174365',
      status: 'New',
      source: 'channel_api',
    });
    await Order.create({
      tenantId: tenant._id,
      orderNo: 'AMZ-902-1845936-5435065',
      channel: 'Amazon',
      externalOrderId: '902-1845936-5435065',
      status: 'New',
      source: 'channel_api',
    });
    await Order.create({
      tenantId: tenant._id,
      orderNo: 'MYN-100326565624',
      channel: 'Myntra',
      externalOrderId: '100326565624',
      status: 'New',
      source: 'channel_api',
    });

    const all = await ordersFor(tenant, { status: 'all' });
    const original = Object.fromEntries(all.map((row) => [row.id, row.channelOrderNo]));
    assert.equal(original['SHP-19028899266653'], '#68762-LEH');
    assert.equal(original['SHP-18966197174365'], '', 'the Shopify internal id is not the order number customers see');
    assert.equal(original['AMZ-902-1845936-5435065'], '902-1845936-5435065');
    assert.equal(original['MYN-100326565624'], '100326565624');

    const found = await ordersFor(tenant, { status: 'all', q: '68762-LEH' });
    assert.deepEqual(found.map((row) => row.id), ['SHP-19028899266653']);
  });
});
