const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const { listBalances, skuDetail, listingUrl } = require('../src/services/inventory.service');

let mongo;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('listingUrl opens the product on the marketplace website', () => {
  assert.equal(listingUrl('amazon', 'B0G5DWS5BC'), 'https://www.amazon.in/dp/B0G5DWS5BC');
  assert.equal(listingUrl('myntra', '38589810'), 'https://www.myntra.com/38589810');
  assert.equal(listingUrl('myntra', ' 38589810 '), 'https://www.myntra.com/38589810');
  assert.equal(listingUrl('amazon', 'B0/../x?y'), 'https://www.amazon.in/dp/B0%2F..%2Fx%3Fy', 'id is URL-encoded');
  assert.equal(listingUrl('amazon', ''), '', 'no listing id, no link');
  assert.equal(listingUrl('shopify', '8812345'), '', 'no public link without the store domain');
  assert.equal(listingUrl('custom', 'X1'), '');
});

test('each channel listing on the product page carries its marketplace link', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Leheriya', slug: `leheriya-url-${stamp}`, kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `LEH-URL-${stamp}`, name: 'Pure Cotton Dress Material', mrp: 3999 });
  await listBalances(String(tenant._id));
  const base = { tenantId: tenant._id, masterSkuId: sku._id, syncStatus: 'synced' };
  await SkuMapping.create([
    { ...base, channel: 'amazon', channelProductId: 'B0G5DWS5BC', channelVariantId: `a-${stamp}`, channelSkuCode: '1206FRF0B8U', channelSkuCodeNorm: '1206frf0b8u' },
    { ...base, channel: 'myntra', channelProductId: '38589810', channelVariantId: `m-${stamp}`, channelSkuCode: '123234599', channelSkuCodeNorm: '123234599' },
    { ...base, channel: 'shopify', channelProductId: '8812345', channelVariantId: `s-${stamp}`, channelSkuCode: 'LEH-250711', channelSkuCodeNorm: 'leh-250711' },
  ]);

  const { listings } = await skuDetail(String(tenant._id), String(sku._id));
  const byChannel = Object.fromEntries(listings.map((row) => [row.channel, row.listingUrl]));
  assert.equal(byChannel.amazon, 'https://www.amazon.in/dp/B0G5DWS5BC');
  assert.equal(byChannel.myntra, 'https://www.myntra.com/38589810');
  assert.equal(byChannel.shopify, '');
});
