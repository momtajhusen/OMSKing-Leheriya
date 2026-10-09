process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const WarehouseLocationMap = require('../src/models/WarehouseLocationMap');
const SkuMapping = require('../src/models/SkuMapping');
const Inventory = require('../src/models/Inventory');
const IntegrationJob = require('../src/models/IntegrationJob');
const { stockIn, reserveStock } = require('../src/services/inventory.service');
const { ensureDefaultWarehouses, setInventoryAuthority } = require('../src/services/warehouse.service');
const { upsertConnection } = require('../src/services/channelConnection.service');
const { channelQty, runInventoryJob } = require('../src/services/inventoryPush.service');

let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

function shopifyMock(levels = 7) {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (String(url).includes('/variants/')) {
      return { status: 200, headers: {}, text: JSON.stringify({ variant: { inventory_item_id: 55 } }) };
    }
    if (String(url).includes('/inventory_levels/set')) return { status: 200, headers: {}, text: '{}' };
    if (String(url).includes('/inventory_levels.json')) {
      return { status: 200, headers: {}, text: JSON.stringify({ inventory_levels: [{ available: levels }] }) };
    }
    return { status: 404, headers: {}, text: '' };
  };
  return { calls, request };
}

function amazonMock() {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (String(url).includes('/auth/o2/token')) return { status: 200, text: JSON.stringify({ access_token: 'tok' }) };
    return { status: 200, text: '{}' };
  };
  return { calls, request };
}

async function seedSeller() {
  const tenant = await Tenant.create({ name: 'Push shop', slug: `push-${Date.now()}`, kind: 'merchant' });
  const { physical, virtual } = await ensureDefaultWarehouses(tenant._id);
  const sku = await MasterSku.create({ tenantId: tenant._id, code: 'KURTA-RED-L', name: 'Red kurta' });
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
  const maps = await WarehouseLocationMap.find({ tenantId: tenant._id, channel: 'shopify' });
  for (const row of maps) {
    row.externalLocationId = String(row.warehouseId) === String(physical._id) ? '111' : '222';
    await row.save();
  }
  await upsertConnection(tenant._id, null, 'shopify', { credentials: { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' } });
  await upsertConnection(tenant._id, null, 'amazon', {
    credentials: { sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's', apiMode: 'live' },
  });
  await upsertConnection(tenant._id, null, 'myntra', {
    credentials: { merchantId: 'M1', secretKey: 'S1', storeId: 'STORE1', apiMode: 'live' },
  });
  await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: physical._id, qty: 4, reason: 'opening' });
  await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: virtual._id, qty: 1000, reason: 'virtual' });
  return { tenant, physical, virtual, sku };
}

test('OMS qty pushes Location A 4, Location B 1000, Amazon 4, Myntra 4, then reserve drops only WH-001', async () => {
  const { tenant, sku } = await seedSeller();
  const before = await channelQty(tenant._id, sku._id);
  assert.deepEqual(before.shopify.map((row) => row.available).sort((a, b) => a - b), [4, 1000]);
  assert.equal(before.amazon, 4);
  assert.equal(before.myntra, 4);

  const shopify = shopifyMock();
  const amz = amazonMock();
  const myntraItems = [];
  const jobs = await IntegrationJob.find({ tenantId: tenant._id, jobType: 'inventory_push', status: 'queued' });
  assert.equal(jobs.length, 3);
  for (const job of jobs) {
    await runInventoryJob(job, {
      shopifyRequest: shopify.request,
      amazonRequest: amz.request,
      myntraClient: { updateInventory: async (items) => { myntraItems.push(...items); return []; } },
    });
  }
  const sets = shopify.calls.filter((call) => call.url.includes('/inventory_levels/set')).map((call) => call.body);
  assert.deepEqual(sets.map((body) => body.available).sort((a, b) => a - b), [4, 1000]);
  assert.deepEqual(sets.map((body) => body.location_id).sort((a, b) => a - b), [111, 222]);
  const patch = amz.calls.find((call) => call.method === 'PATCH');
  assert.equal(patch.body.patches[0].value[0].quantity, 4);
  assert.match(patch.url, /sellingpartnerapi-eu\.amazon\.com/);
  assert.deepEqual(myntraItems, [{ sku: 'KURTA-RED-L', quantity: 4 }]);

  await reserveStock(String(tenant._id), null, {
    masterSkuId: sku._id,
    channel: 'amazon',
    qty: 1,
    idempotencyKey: 'reserve-1',
    orderRef: 'ORD-1',
  });
  const after = await channelQty(tenant._id, sku._id);
  assert.equal(after.amazon, 3);
  assert.equal(after.myntra, 3);
  assert.equal(after.shopify.find((row) => row.locationId === '111').available, 3);
  assert.equal(after.shopify.find((row) => row.locationId === '222').available, 1000);

  const again = await IntegrationJob.find({ tenantId: tenant._id, jobType: 'inventory_push', status: 'queued' });
  const shopify2 = shopifyMock();
  const amz2 = amazonMock();
  const myntra2 = [];
  for (const job of again) {
    await runInventoryJob(job, {
      shopifyRequest: shopify2.request,
      amazonRequest: amz2.request,
      myntraClient: { updateInventory: async (items) => { myntra2.push(...items); return []; } },
    });
  }
  assert.deepEqual(shopify2.calls.filter((call) => call.url.includes('/set')).map((call) => call.body.available).sort((a, b) => a - b), [3, 1000]);
  assert.equal(amz2.calls.find((call) => call.method === 'PATCH').body.patches[0].value[0].quantity, 3);
  assert.deepEqual(myntra2, [{ sku: 'KURTA-RED-L', quantity: 3 }]);
  assert.equal(await Inventory.countDocuments({ tenantId: tenant._id, reservedQty: { $gt: 0 } }), 1);
});

test('Shopify inventory master reads Location A into WH-001 and does not push Shopify', async () => {
  const { tenant, physical, sku } = await seedSeller();
  await setInventoryAuthority(tenant._id, 'shopify');
  await IntegrationJob.deleteMany({ tenantId: tenant._id });
  const job = await IntegrationJob.create({
    tenantId: tenant._id,
    channel: 'shopify',
    jobType: 'inventory_push',
    direction: 'push',
    status: 'queued',
    payload: { masterSkuId: String(sku._id) },
  });
  const shopify = shopifyMock(7);
  await runInventoryJob(job, { shopifyRequest: shopify.request });
  assert.equal(shopify.calls.some((call) => call.url.includes('/inventory_levels/set')), false);
  const balance = await Inventory.findOne({ tenantId: tenant._id, warehouseId: physical._id, masterSkuId: sku._id });
  assert.equal(balance.physicalQty, 7);
  const queued = await IntegrationJob.find({
    tenantId: tenant._id,
    status: 'queued',
    jobType: 'inventory_push',
    _id: { $ne: job._id },
  });
  assert.deepEqual(queued.map((row) => row.channel).sort(), ['amazon', 'myntra']);
});
