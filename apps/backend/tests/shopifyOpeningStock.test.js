const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const Warehouse = require('../src/models/Warehouse');
const WarehouseLocationMap = require('../src/models/WarehouseLocationMap');
const SkuMapping = require('../src/models/SkuMapping');
const Inventory = require('../src/models/Inventory');
const InventoryLedger = require('../src/models/InventoryLedger');
const IntegrationJob = require('../src/models/IntegrationJob');
const NotificationDelivery = require('../src/models/NotificationDelivery');
const shopify = require('../src/adapters/shopify');
const { als } = require('../src/lib/tenantContext');
const { stockIn } = require('../src/services/inventory.service');
const { ingestChannelOrders } = require('../src/services/channelOrder.service');
const { importShopifyOpeningStock } = require('../src/services/shopifyOpeningStock.service');
const { listOrders } = require('../src/controllers/orders.controller');

let replSet;
const OFFLINE_LOCATION = '76829392989';
const VIRTUAL_LOCATION = '62567448669';

async function store() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await Tenant.create({ name: 'Leheriya', slug: `leh-${stamp}`, kind: 'merchant' });
  const physical = await Warehouse.create({
    tenantId: tenant._id, code: 'WH-001', name: 'Offline', type: 'physical', isDefault: true, isPickup: true, status: 'active',
  });
  const virtual = await Warehouse.create({
    tenantId: tenant._id, code: 'WH-002', name: 'Virtual', type: 'virtual', isPickup: false, status: 'active',
  });
  await WarehouseLocationMap.create({ tenantId: tenant._id, warehouseId: physical._id, channel: 'shopify', externalLocationId: OFFLINE_LOCATION });
  await WarehouseLocationMap.create({ tenantId: tenant._id, warehouseId: virtual._id, channel: 'shopify', externalLocationId: VIRTUAL_LOCATION });
  const masters = {};
  for (const [code, variant] of [['LEH28', '101'], ['LEHE2681', '102'], ['LEH-ZA1', '103'], ['LEH-OLD', '104']]) {
    masters[code] = await MasterSku.create({ tenantId: tenant._id, code, name: code });
    await SkuMapping.create({
      tenantId: tenant._id,
      masterSkuId: masters[code]._id,
      channel: 'shopify',
      channelVariantId: variant,
      channelSkuCode: code,
      channelSkuCodeNorm: code,
      syncStatus: 'synced',
    });
  }
  return { tenant, physical, virtual, masters };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function ordersFor(tenant) {
  const res = fakeRes();
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false }, () => listOrders({
    tenantId: tenant._id,
    skipTenantFilter: false,
    query: { status: 'all' },
  }, res));
  return res.body?.data || [];
}

function gqlPage(nodes, { next = '' } = {}) {
  return {
    status: 200,
    headers: {},
    text: JSON.stringify({
      data: {
        location: {
          inventoryLevels: {
            pageInfo: { hasNextPage: Boolean(next), endCursor: next || null },
            nodes: nodes.map(([variant, onHand]) => ({
              quantities: [{ name: 'on_hand', quantity: onHand }],
              item: { variant: variant ? { id: `gid://shopify/ProductVariant/${variant}` } : null },
            })),
          },
        },
      },
      extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 900, restoreRate: 100 } } },
    }),
  };
}

describe('Shopify opening stock import', () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  it('reads on-hand stock for one Shopify location with a read-only query, page by page', async () => {
    const calls = [];
    const request = async (method, url, opts) => {
      calls.push({ method, url, body: JSON.parse(opts.body) });
      return calls.length === 1
        ? gqlPage([['101', 19], ['102', 2]], { next: 'CURSOR1' })
        : gqlPage([['103', 0], [null, 5]]);
    };
    const rows = await shopify.pullLocationOnHand(
      { shopUrl: 'leheriya.myshopify.com', adminToken: 'tok', apiMode: 'live' },
      { locationId: OFFLINE_LOCATION, request, sleep: async () => {} },
    );
    assert.deepEqual(rows, [{ variantId: '101', onHand: 19 }, { variantId: '102', onHand: 2 }, { variantId: '103', onHand: 0 }]);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/admin\/api\/2024-10\/graphql\.json$/);
    assert.equal(calls[0].method, 'POST');
    assert.doesNotMatch(calls[0].body.query, /mutation/);
    assert.equal(calls[0].body.variables.id, `gid://shopify/Location/${OFFLINE_LOCATION}`);
    assert.equal(calls[1].body.variables.after, 'CURSOR1');
  });

  it('puts Offline Shop stock in WH-001 and Virtual Warehouse stock in WH-002 once, so an in-stock Shopify line packs Offline', async () => {
    const { tenant, physical, virtual, masters } = await store();
    const tenantId = String(tenant._id);
    await stockIn(tenantId, null, { masterSkuId: masters['LEH-OLD']._id, warehouseId: physical._id, qty: 3, reason: 'Counted', skipNotify: true });
    const pushesBefore = await IntegrationJob.countDocuments({ tenantId: tenant._id, jobType: 'inventory_push' });

    const onHand = {
      [OFFLINE_LOCATION]: [{ variantId: '101', onHand: 19 }, { variantId: '102', onHand: 1 }, { variantId: '104', onHand: 50 }],
      [VIRTUAL_LOCATION]: [{ variantId: '103', onHand: 989 }, { variantId: '999', onHand: 7 }],
    };
    const pull = async (creds, { locationId }) => onHand[locationId] || [];
    const first = await importShopifyOpeningStock(tenantId, null, { pull, creds: {} });
    assert.equal(first.imported, 3);
    assert.equal(first.units, 19 + 1 + 989);

    const qty = async (code, warehouse) => (await Inventory.findOne({ tenantId: tenant._id, masterSkuId: masters[code]._id, warehouseId: warehouse._id }).lean()) || {};
    assert.equal((await qty('LEH28', physical)).physicalQty, 19);
    assert.equal((await qty('LEHE2681', physical)).physicalQty, 1);
    assert.equal((await qty('LEH-ZA1', virtual)).virtualQty, 989);
    assert.equal((await qty('LEH-OLD', physical)).physicalQty, 3, 'stock already counted in OMS is kept');
    assert.equal(await InventoryLedger.countDocuments({ tenantId: tenant._id, referenceType: 'shopify_opening' }), 3);

    const again = await importShopifyOpeningStock(tenantId, null, { pull, creds: {} });
    assert.equal(again.imported, 0);
    assert.equal((await qty('LEH28', physical)).physicalQty, 19, 'a second run does not add stock twice');

    assert.equal(await IntegrationJob.countDocuments({ tenantId: tenant._id, jobType: 'inventory_push' }), pushesBefore, 'no Shopify stock push is queued');
    assert.equal(await NotificationDelivery.countDocuments({ tenantId: tenant._id }), 0, 'no low stock alerts are sent');

    const order = shopify.mapShopifyOrder({
      id: 19025505452125,
      financial_status: 'paid',
      line_items: [
        { sku: 'LEH28', title: 'Pochampally', quantity: 1, price: '1499.00', variant_id: 101 },
        { sku: 'LEH-ZA1', title: 'Mangalgiri', quantity: 1, price: '2199.00', variant_id: 103 },
      ],
    }, {});
    await ingestChannelOrders(tenantId, 'shopify', [order]);
    const row = (await ordersFor(tenant)).find((one) => one.id === 'SHP-19025505452125');
    const source = Object.fromEntries(row.items.map((item) => [item.sku, item.fulfilmentSource]));
    assert.equal(source.LEH28, 'Offline');
    assert.equal(source['LEH-ZA1'], 'Virtual');
  });

  it('queues the import as a Shopify background job and refuses other channels', async () => {
    const { tenant } = await store();
    const { enqueueManual } = require('../src/services/jobQueue.service');
    const job = await enqueueManual(String(tenant._id), null, { channel: 'shopify', jobType: 'stock_import' });
    assert.equal(job.jobType, 'stock_import');
    await assert.rejects(
      enqueueManual(String(tenant._id), null, { channel: 'amazon', jobType: 'stock_import' }),
      /Shopify/,
    );
  });

  it('refuses to run before the Shopify locations are linked to warehouses', async () => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenant = await Tenant.create({ name: 'Bare', slug: `bare-${stamp}`, kind: 'merchant' });
    await assert.rejects(
      importShopifyOpeningStock(String(tenant._id), null, { pull: async () => [], creds: {} }),
      /Shopify locations are not linked/,
    );
  });
});
