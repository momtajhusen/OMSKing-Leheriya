const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const amazon = require('../src/adapters/amazon');
const channelConnection = require('../src/services/channelConnection.service');
const channelOrder = require('../src/services/channelOrder.service');
const { importListings } = require('../src/controllers/skuMappings.controller');

const creds = { apiMode: 'sandbox', sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's' };
let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await Promise.all([MasterSku.syncIndexes(), SkuMapping.syncIndexes()]);
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

async function importCsv(tenant, channel, csv) {
  const res = { status() { return this; }, json(body) { this.body = body; return this; } };
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false }, () => importListings({
    tenantId: String(tenant._id), user: { id: null, role: 'super_admin' }, params: {}, query: {}, body: { channel, csv },
  }, res));
  return res.body;
}

async function syncWith(pulled, claim) {
  const saved = [];
  const original = {
    getConnection: channelConnection.getConnection,
    credsOf: channelConnection.credsOf,
    claimChannelOrder: channelOrder.claimChannelOrder,
    finishChannelOrder: channelOrder.finishChannelOrder,
    pullOrders: amazon.pullOrders,
  };
  channelConnection.getConnection = async () => ({});
  channelConnection.credsOf = () => creds;
  channelOrder.claimChannelOrder = claim || (async (_key, next) => { saved.push(next); return { doc: next, created: true }; });
  channelOrder.finishChannelOrder = async (_tenantId, doc) => { if (claim) saved.push(doc); return 'created'; };
  amazon.pullOrders = async () => pulled;
  try {
    delete require.cache[require.resolve('../src/services/amazonSync.service')];
    const { pullAmazonOrders } = require('../src/services/amazonSync.service');
    await pullAmazonOrders(pulled.tenantId);
  } finally {
    Object.assign(channelConnection, { getConnection: original.getConnection, credsOf: original.credsOf });
    Object.assign(channelOrder, { claimChannelOrder: original.claimChannelOrder, finishChannelOrder: original.finishChannelOrder });
    amazon.pullOrders = original.pullOrders;
    delete require.cache[require.resolve('../src/services/amazonSync.service')];
  }
  return saved;
}

test('Amazon order pull reads the order items (seller SKU, title, qty) instead of the order id', async () => {
  const urls = [];
  const replies = [
    { status: 200, text: JSON.stringify({ access_token: 'token' }) },
    { status: 200, text: JSON.stringify({ payload: { Orders: [
      { AmazonOrderId: '402-1', OrderStatus: 'Unshipped', OrderTotal: { Amount: '1998' }, NumberOfItemsUnshipped: 2 },
      { AmazonOrderId: '402-2', OrderStatus: 'Unshipped', OrderTotal: { Amount: '500' }, NumberOfItemsUnshipped: 1 },
    ] } }) },
    { status: 200, text: JSON.stringify({ payload: { AmazonOrderId: '402-1', OrderItems: [
      { SellerSKU: 'AMZ-K1', ASIN: 'B0K1', Title: 'Blue kurta (Amazon)', QuantityOrdered: 2, ItemPrice: { Amount: '1998' } },
    ] } }) },
    { status: 500, text: '{}' },
  ];
  const rows = await amazon.pullOrders(creds, { request: async (_method, url) => { urls.push(url); return replies.shift(); } });
  assert.match(urls[2], /\/orders\/v0\/orders\/402-1\/orderItems$/);
  assert.deepEqual(rows[0].items, [{ name: 'Blue kurta (Amazon)', sku: 'AMZ-K1', qty: 2, price: 1998 }]);
  assert.equal(rows[0].itemsKnown, true);
  assert.equal(rows[1].items[0].sku, '402-2', 'order items call failed: the header placeholder stays');
  assert.equal(rows[1].itemsKnown, false);
});

test('Amazon sync shows the Shopify SKU and photo (Amazon photo first, Shopify photo as fallback)', async () => {
  const tenant = await Tenant.create({ name: 'Amazon photo shop', slug: `amz-photo-${Date.now()}`, kind: 'merchant' });
  await importCsv(tenant, 'shopify', [
    'sku,title,price,image,channelVariantId',
    'LH-Kurta-01,Blue kurta,999,https://cdn.shopify.com/s/files/blue.jpg,shop-1',
    'LH-Kurta-02,Red kurta,999,https://cdn.shopify.com/s/files/red.jpg,shop-2',
    'LH-Kurta-03,Green kurta,999,https://cdn.shopify.com/s/files/green.jpg,shop-3',
  ].join('\n'));
  const master1 = await MasterSku.findOne({ tenantId: tenant._id, code: 'LH-KURTA-01' });
  const master3 = await MasterSku.findOne({ tenantId: tenant._id, code: 'LH-KURTA-03' });
  await SkuMapping.create([
    { tenantId: tenant._id, channel: 'amazon', masterSkuId: master1._id, channelVariantId: 'AMZ-K1', channelSkuCode: 'AMZ-K1', channelSkuCodeNorm: 'AMZ-K1' },
    { tenantId: tenant._id, channel: 'amazon', masterSkuId: master3._id, channelVariantId: 'AMZ-K3', channelSkuCode: 'AMZ-K3', channelSkuCodeNorm: 'AMZ-K3', imageUrl: 'https://m.media-amazon.com/images/I/k3.jpg' },
  ]);
  const pulled = [{
    externalOrderId: '402-9', status: 'Ready to Ship', total: 4000, itemsKnown: true,
    items: [
      { name: 'Amazon title 1', sku: 'AMZ-K1', qty: 1, price: 1000 },
      { name: 'Amazon title 2', sku: 'LH-Kurta-02', qty: 1, price: 1000 },
      { name: 'Amazon title 3', sku: 'AMZ-K3', qty: 1, price: 1000 },
      { name: 'Amazon title 4', sku: 'UNMAPPED-9', qty: 1, price: 1000 },
    ],
  }];
  pulled.tenantId = tenant._id;
  const [order] = await syncWith(pulled);
  const view = order.items.map(({ name, sku, imageUrl }) => ({ name, sku, imageUrl: imageUrl || '' }));
  assert.deepEqual(view, [
    { name: 'Blue kurta', sku: 'LH-Kurta-01', imageUrl: 'https://cdn.shopify.com/s/files/blue.jpg' },
    { name: 'Red kurta', sku: 'LH-Kurta-02', imageUrl: 'https://cdn.shopify.com/s/files/red.jpg' },
    { name: 'Green kurta', sku: 'LH-Kurta-03', imageUrl: 'https://m.media-amazon.com/images/I/k3.jpg' },
    { name: 'Amazon title 4', sku: 'UNMAPPED-9', imageUrl: '' },
  ]);
  assert.equal(String(order.items[0].masterSkuId), String(master1._id));
  assert.equal(order.subOrders[0].sku, 'LH-Kurta-01');
  assert.equal(order.subOrders[0].imageUrl, 'https://cdn.shopify.com/s/files/blue.jpg');
});

test('a later Amazon pull without order items keeps the items already saved', async () => {
  const kept = [{ name: 'Blue kurta', sku: 'LH-Kurta-01', qty: 1, price: 1000, imageUrl: 'https://cdn.shopify.com/s/files/blue.jpg' }];
  const doc = { status: 'New', total: 1000, items: kept, subOrders: [{ sku: 'LH-Kurta-01' }], channelLines: [] };
  const pulled = [{
    externalOrderId: '402-9', status: 'Ready to Ship', total: 1000, itemsKnown: false,
    items: [{ name: 'Amazon Unshipped', sku: '402-9', qty: 1, price: 1000 }],
  }];
  pulled.tenantId = new mongoose.Types.ObjectId();
  const [saved] = await syncWith(pulled, async () => ({ doc, created: false }));
  assert.equal(saved.status, 'Ready to Ship');
  assert.equal(saved.items, kept);
  assert.equal(saved.subOrders[0].sku, 'LH-Kurta-01');
});
