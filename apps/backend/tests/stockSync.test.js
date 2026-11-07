process.env.NODE_ENV = 'test';

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
const Inventory = require('../src/models/Inventory');
const IntegrationJob = require('../src/models/IntegrationJob');
const { stockIn } = require('../src/services/inventory.service');
const { syncOrderReservations } = require('../src/services/orderReserve.service');
const { channelQty, runInventoryJob } = require('../src/services/inventoryPush.service');
const { upsertConnection } = require('../src/services/channelConnection.service');
const { importShopifyOpeningStock } = require('../src/services/shopifyOpeningStock.service');
const { deleteCheck } = require('../src/services/channelWarehouse.service');
const { buildOrderSummary } = require('../src/services/orderSummary.service');
const shopify = require('../src/adapters/shopify');

let replSet;
const DAY = 24 * 60 * 60 * 1000;

async function seller() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await Tenant.create({ name: 'Stock', slug: `stk-${stamp}`, kind: 'merchant' });
  const physical = await Warehouse.create({
    tenantId: tenant._id, code: 'WH-001', name: 'Main', type: 'physical', isDefault: true, isPickup: true,
    sellOnShopify: true, sellOnMyntra: true, sellOnAmazon: true, status: 'active',
  });
  const skus = [];
  for (const code of ['A', 'B']) {
    const sku = await MasterSku.create({ tenantId: tenant._id, code: `${code}-${stamp}`, name: code });
    await SkuMapping.create({
      tenantId: tenant._id, masterSkuId: sku._id, channel: 'myntra', channelVariantId: `myn-${code}-${stamp}`,
      channelSkuCode: `MYN-${code}`, channelSkuCodeNorm: `myn-${code.toLowerCase()}`, syncStatus: 'synced', isActive: true,
    });
    await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: physical._id, qty: 10, reason: 'opening', skipNotify: true });
    skus.push(sku);
  }
  return { tenantId: tenant._id, physical, skus };
}

const pushJobs = (ctx) => IntegrationJob.find({ tenantId: ctx.tenantId, jobType: 'inventory_push' }).setOptions({ skipTenantFilter: true }).lean();

describe('stock writes and channel stock sync', () => {
  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  it('cancelling or dispatching a two-SKU order pushes channel stock for both SKUs', async () => {
    const ctx = await seller();
    const items = ctx.skus.map((sku, i) => ({ sku: `MYN-${i ? 'B' : 'A'}`, qty: 1, masterSkuId: sku._id, warehouseId: ctx.physical._id }));
    const doc = await Order.create({ tenantId: ctx.tenantId, orderNo: 'M-1', channel: 'Myntra', externalOrderId: 'M-1', status: 'New', items });
    await syncOrderReservations(ctx.tenantId, doc, { notify: false });
    doc.status = 'Cancelled';
    await syncOrderReservations(ctx.tenantId, doc);
    const released = new Set((await pushJobs(ctx)).map((job) => job.payload.masterSkuId));
    assert.deepEqual([...released].sort(), ctx.skus.map((sku) => String(sku._id)).sort());

    await IntegrationJob.deleteMany({ tenantId: ctx.tenantId });
    const two = await Order.create({ tenantId: ctx.tenantId, orderNo: 'M-2', channel: 'Myntra', externalOrderId: 'M-2', status: 'New', items });
    await syncOrderReservations(ctx.tenantId, two, { notify: false });
    two.status = 'Dispatched';
    await two.save();
    const consumed = new Set((await pushJobs(ctx)).map((job) => job.payload.masterSkuId));
    assert.equal(consumed.size, 2);
  });

  it('a push re-reads stock after sending and sends again if it changed meanwhile', async () => {
    const ctx = await seller();
    await upsertConnection(ctx.tenantId, null, 'myntra', { credentials: { merchantId: 'M1', secretKey: 'S1', storeId: 'STORE1', apiMode: 'live' } });
    const job = await IntegrationJob.create({ tenantId: ctx.tenantId, channel: 'myntra', jobType: 'inventory_push', status: 'running', payload: { masterSkuId: String(ctx.skus[0]._id) } });
    const sent = [];
    let first = true;
    await runInventoryJob(job, {
      myntraClient: {
        updateInventory: async (items) => {
          sent.push(items[0].quantity ?? items[0].inventoryCount ?? items[0].qty);
          if (first) {
            first = false;
            await stockIn(String(ctx.tenantId), null, { masterSkuId: ctx.skus[0]._id, warehouseId: ctx.physical._id, qty: 2, reason: 'late receipt', skipNotify: true });
          }
          return [];
        },
      },
    });
    assert.deepEqual(sent, [10, 12]);
  });

  it('a Shopify read with no stock level fails instead of writing 0', async () => {
    const request = async (method, url) => {
      if (String(url).includes('/variants/')) return { status: 200, text: JSON.stringify({ variant: { inventory_item_id: 55 } }) };
      return { status: 200, text: JSON.stringify({ inventory_levels: [] }) };
    };
    await assert.rejects(
      shopify.readLocationAvailable({ shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' }, { variantId: '1', locationId: '111', request }),
      /no stock level/i,
    );
  });

  it('a Shopify location linked to a warehouse that does not sell on Shopify is never pushed', async () => {
    const ctx = await seller();
    const other = await Warehouse.create({ tenantId: ctx.tenantId, code: 'WH-009', name: 'Store', type: 'physical', sellOnShopify: false, status: 'active' });
    await stockIn(String(ctx.tenantId), null, { masterSkuId: ctx.skus[0]._id, warehouseId: other._id, qty: 7, reason: 'opening', skipNotify: true });
    await WarehouseLocationMap.create({ tenantId: ctx.tenantId, warehouseId: other._id, channel: 'shopify', externalLocationId: '909' });
    const qty = await channelQty(ctx.tenantId, ctx.skus[0]._id);
    const loc = qty.shopify.find((row) => row.locationId === '909');
    assert.equal(loc.known, false);
  });

  it('Shopify opening stock ignores inactive listings', async () => {
    const ctx = await seller();
    const fresh = await MasterSku.create({ tenantId: ctx.tenantId, code: `C-${Date.now()}`, name: 'C' });
    await WarehouseLocationMap.create({ tenantId: ctx.tenantId, warehouseId: ctx.physical._id, channel: 'shopify', externalLocationId: '111' });
    await SkuMapping.create({ tenantId: ctx.tenantId, masterSkuId: fresh._id, channel: 'shopify', channelVariantId: 'v-live', channelSkuCode: 'C', channelSkuCodeNorm: 'c', syncStatus: 'synced', isActive: true });
    await SkuMapping.create({ tenantId: ctx.tenantId, masterSkuId: fresh._id, channel: 'shopify', channelVariantId: 'v-old', channelSkuCode: 'C-OLD', channelSkuCodeNorm: 'c-old', syncStatus: 'synced', isActive: false });
    await importShopifyOpeningStock(ctx.tenantId, null, {
      creds: {},
      pull: async () => [{ variantId: 'v-live', onHand: 3 }, { variantId: 'v-old', onHand: 3 }],
    });
    const row = await Inventory.findOne({ tenantId: ctx.tenantId, masterSkuId: fresh._id, warehouseId: ctx.physical._id }).setOptions({ skipTenantFilter: true }).lean();
    assert.equal(row.physicalQty, 3);
  });

  it('a warehouse holding channel-only stock cannot be deleted', async () => {
    const ctx = await seller();
    const spare = await Warehouse.create({ tenantId: ctx.tenantId, code: 'WH-010', name: 'Spare', type: 'physical', status: 'active' });
    await Inventory.create({ tenantId: ctx.tenantId, masterSkuId: ctx.skus[0]._id, warehouseId: spare._id, channelOnly: { myntra: 2 } });
    const check = await deleteCheck(ctx.tenantId, String(spare._id));
    assert.equal(check.canDelete, false);
  });

  it('the dashboard day filter uses whole local days, matching the trend chart', () => {
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const outside = new Date(todayStart - 7 * DAY + DAY - 60000).toISOString();
    const summary = buildOrderSummary([{ id: 'X', channel: 'Shopify', status: 'New', createdAt: outside, items: [] }], { days: 7, tzOffset: 0 });
    assert.equal(summary.total, 0);
  });
});
