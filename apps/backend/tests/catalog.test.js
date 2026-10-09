process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const Inventory = require('../src/models/Inventory');
const ChannelConnection = require('../src/models/ChannelConnection');
const WarehouseLocationMap = require('../src/models/WarehouseLocationMap');
const { importChannel } = require('../src/services/catalogMapping.service');
const { ingestPulledCatalog } = require('../src/services/catalogPull.service');
const { pullCatalog, variantRows } = require('../src/adapters/shopify');
const { listingRows, pullCatalog: pullAmazonCatalog, amazonHost, probeConnection } = require('../src/adapters/amazon');
const { upsertConnection, recordTest, credsOf } = require('../src/services/channelConnection.service');
const myntraAdapter = require('../src/adapters/myntra');
const { generateMasterCode, assertHsnCode } = require('../src/services/skuIdentity.service');

let memory;
let tenant;

function run(work) {
  return als.run({ tenantId: String(tenant._id), skipTenantFilter: false }, work);
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await Promise.all([MasterSku.syncIndexes(), SkuMapping.syncIndexes(), ChannelConnection.syncIndexes()]);
  tenant = await Tenant.create({ name: 'Catalog shop', slug: `cat-${Date.now()}`, kind: 'merchant' });
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('a long seller SKU stays the Master SKU code', async () => {
  const code = await run(() => generateMasterCode(tenant._id, { requested: 'LEHMODALEVER5' }));
  assert.equal(code, 'LEHMODALEVER5');
  assert.throws(() => assertHsnCode('12'), /4–8 digits/);
  assert.equal(assertHsnCode('6204'), '6204');
});

test('Shopify CSV creates one master, Myntra matches it, Amazon with no match stays unmapped and stockless', async () => {
  await run(() => ChannelConnection.create({
    tenantId: tenant._id,
    channel: 'shopify',
    status: 'connected',
  }));
  const row = {
    channelSkuCode: 'KURTA-BLUE-M',
    channelVariantId: 'shop-var-1',
    channelProductId: 'shop-prod-1',
    channelTitle: 'Blue kurta M',
    barcode: '8901111111111',
    price: 1499,
    hsnCode: '6204',
  };
  const shopify = await run(() => importChannel(tenant._id, null, 'shopify', [row]));
  assert.equal(shopify.created, 1);
  assert.equal(shopify.rows[0].masterSku, 'KURTA-BLUE-M');
  const created = await MasterSku.findOne({ tenantId: tenant._id, code: 'KURTA-BLUE-M' });
  assert.equal(created.barcode, '8901111111111');

  const myntra = await run(() => importChannel(tenant._id, null, 'myntra', [{
    ...row,
    channelVariantId: 'myn-var-1',
    channelProductId: 'myn-prod-1',
  }]));
  assert.equal(myntra.autoMapped, 1);
  assert.equal(myntra.created, 0);
  assert.equal(myntra.rows[0].masterSku, 'KURTA-BLUE-M');

  const amazon = await run(() => importChannel(tenant._id, null, 'amazon', [{
    channelSkuCode: 'UNKNOWN-ASIN',
    channelVariantId: 'amz-1',
    channelProductId: 'B000',
    channelTitle: 'No match',
  }]));
  assert.equal(amazon.unmapped, 1);
  assert.equal(amazon.created, 0);

  const masters = await MasterSku.find({ tenantId: tenant._id, code: { $in: ['KURTA-BLUE-M', 'UNKNOWN-ASIN'] } });
  assert.equal(masters.length, 1);
  const stock = await Inventory.countDocuments({ tenantId: tenant._id });
  assert.equal(stock, 0);
  const unmapped = await SkuMapping.findOne({ tenantId: tenant._id, channel: 'amazon', channelSkuCode: 'UNKNOWN-ASIN' });
  assert.equal(unmapped.syncStatus, 'unmapped');
  assert.equal(unmapped.masterSkuId, null);
});

test('Myntra CSV creates the master when Shopify is not the catalog', async () => {
  const other = await Tenant.create({ name: 'Myntra first', slug: `myn-${Date.now()}`, kind: 'merchant' });
  const summary = await als.run({ tenantId: String(other._id), skipTenantFilter: false }, () => importChannel(other._id, null, 'myntra', [{
    channelSkuCode: 'MYN-ONLY-1',
    channelVariantId: 'myn-only-1',
    channelProductId: 'p-myn',
    channelTitle: 'Only on Myntra',
    price: 500,
  }]));
  assert.equal(summary.created, 1);
  assert.equal(summary.rows[0].masterSku, 'MYN-ONLY-1');
  const amazon = await als.run({ tenantId: String(other._id), skipTenantFilter: false }, () => importChannel(other._id, null, 'amazon', [{
    channelSkuCode: 'MYN-ONLY-1',
    channelVariantId: 'amz-same',
    channelTitle: 'Same kurta',
  }]));
  assert.equal(amazon.autoMapped, 1);
  assert.equal(amazon.rows[0].masterSku, 'MYN-ONLY-1');
});

test('one kurta pulled on three channels is one master, real Shopify locations, and no stock', async () => {
  const shop = await Tenant.create({ name: 'Live catalog', slug: `live-${Date.now()}`, kind: 'merchant' });
  const kurta = {
    channelSkuCode: 'KURTA-RED-L',
    channelVariantId: 'shop-9',
    channelProductId: 'prod-9',
    channelTitle: 'Red kurta L',
    barcode: '8902222222222',
    price: 1999,
  };
  const runShop = (work) => als.run({ tenantId: String(shop._id), skipTenantFilter: false }, work);
  const shopify = await runShop(() => ingestPulledCatalog(shop._id, null, 'shopify', {
    rows: [kurta],
    locations: [
      { id: 'gid-wh-001', name: 'Offline store', active: true },
      { id: 'gid-wh-002', name: 'Virtual', active: true },
    ],
  }));
  assert.equal(shopify.created, 1);
  assert.equal(shopify.locationsBound, 2);
  assert.equal(shopify.stockCreated, 0);

  const myntra = await runShop(() => ingestPulledCatalog(shop._id, null, 'myntra', {
    rows: [{ ...kurta, channelVariantId: 'myn-9', channelProductId: 'style-9' }],
  }));
  assert.equal(myntra.autoMapped, 1);
  assert.equal(myntra.created, 0);

  const amazon = await runShop(() => ingestPulledCatalog(shop._id, null, 'amazon', {
    rows: [{ ...kurta, channelVariantId: 'KURTA-RED-L', channelProductId: 'B00KURTA' }],
  }));
  assert.equal(amazon.autoMapped, 1);

  const stray = await runShop(() => ingestPulledCatalog(shop._id, null, 'amazon', {
    rows: [{ channelSkuCode: 'NO-BARCODE', channelVariantId: 'NO-BARCODE', channelProductId: 'B00NONE', channelTitle: 'No match' }],
  }));
  assert.equal(stray.unmapped, 1);
  assert.equal(stray.created, 0);

  const masters = await MasterSku.find({ tenantId: shop._id });
  assert.deepEqual(masters.map((row) => row.code), ['KURTA-RED-L']);
  const maps = await SkuMapping.find({ tenantId: shop._id, masterSkuId: masters[0]._id });
  assert.deepEqual(maps.map((row) => row.channel).sort(), ['amazon', 'myntra', 'shopify']);
  const locations = await WarehouseLocationMap.find({ tenantId: shop._id, channel: 'shopify' }).lean();
  assert.deepEqual(locations.map((row) => row.externalLocationId).sort(), ['gid-wh-001', 'gid-wh-002']);
  assert.equal(await Inventory.countDocuments({ tenantId: shop._id }), 0);
});

test('Shopify and Amazon payloads normalize, and Myntra catalog list is refused', async () => {
  const rows = variantRows({
    id: 10,
    title: 'Kurta',
    image: { src: 'https://cdn.example/kurta.jpg' },
    variants: [{ id: 11, sku: 'KURTA-RED-L', barcode: '8902222222222', price: '1999.00', title: 'L' }],
  });
  assert.equal(rows[0].channelSkuCode, 'KURTA-RED-L');
  assert.equal(rows[0].barcode, '8902222222222');
  assert.equal(rows[0].image, 'https://cdn.example/kurta.jpg');

  const pages = [
    { status: 200, headers: { link: '<https://shop.example/next>; rel="next"' }, text: JSON.stringify({ products: [{ id: 1, title: 'Kurta', variants: [{ id: 2, sku: 'K1', barcode: '111', price: '10', title: 'M' }] }] }) },
    { status: 200, headers: {}, text: JSON.stringify({ products: [] }) },
    { status: 200, headers: {}, text: JSON.stringify({ locations: [{ id: 55, name: 'A', active: true }, { id: 66, name: 'B', active: true }] }) },
  ];
  const pulled = await pullCatalog(
    { shopUrl: 'shop.example', adminToken: 'shpat_test' },
    { request: async () => pages.shift() },
  );
  assert.equal(pulled.rows[0].channelSkuCode, 'K1');
  assert.deepEqual(pulled.locations.map((loc) => loc.id), ['55', '66']);

  const listings = listingRows([{
    sku: 'K1',
    summaries: [{ asin: 'B001', itemName: 'Kurta', mainImage: { link: 'https://m.media-amazon.com/images/I/kurta.jpg' } }],
    attributes: { externally_assigned_product_identifier: [{ value: '111' }] },
  }]);
  assert.equal(listings[0].channelProductId, 'B001');
  assert.equal(listings[0].barcode, '111');
  assert.equal(listings[0].image, 'https://m.media-amazon.com/images/I/kurta.jpg');

  const myntraRows = myntraAdapter.productRows([{
    productId: 1894501,
    productName: 'Kurta',
    articleType: { typeName: 'Kurtas' },
    styleImages: { default: { imageURL: 'https://assets.myntassets.com/kurta.jpg' } },
    productOptions: [{
      sku: { skuId: 99, sellerSkuCode: 'KURTA-RED-L', size: 'L' },
      barcode: '8902222222222',
      price: 1999,
      mrp: 2499,
    }],
  }]);
  assert.equal(myntraRows[0].channelSkuCode, 'KURTA-RED-L');
  assert.equal(myntraRows[0].channelProductId, '1894501');
  assert.equal(myntraRows[0].image, 'https://assets.myntassets.com/kurta.jpg');
  await assert.rejects(() => myntraAdapter.pullCatalog({}), /Merchant Id and Secret Key are missing/);
  await assert.rejects(
    () => pullCatalog({}),
    /Shop URL and Admin API token are missing/,
  );
});

test('amazon sandbox and live catalog calls use the environment from credentials', async () => {
  const urls = [];
  const request = async (_method, url) => {
    urls.push(url);
    if (String(url).includes('/auth/o2/token')) return { status: 200, text: JSON.stringify({ access_token: 'tok' }) };
    return { status: 200, text: JSON.stringify({ items: [{ sku: 'GM-ZDPI-9B4E', summaries: [{ asin: 'B1', itemName: 'Bag' }] }] }) };
  };
  const creds = { sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's' };
  const sandbox = await pullAmazonCatalog({ ...creds, apiMode: 'sandbox' }, { request });
  assert.equal(sandbox.rows[0].channelSkuCode, 'GM-ZDPI-9B4E');
  assert.match(urls.find((url) => url.includes('/listings/')), /sandbox\.sellingpartnerapi-na\.amazon\.com/);
  assert.match(urls.find((url) => url.includes('/listings/')), /identifiers=GM-ZDPI-9B4E/);
  urls.length = 0;
  await pullAmazonCatalog({ ...creds, apiMode: 'live' }, { request });
  assert.match(urls.find((url) => url.includes('/listings/')), /sellingpartnerapi-eu\.amazon\.com/);
  assert.doesNotMatch(urls.find((url) => url.includes('/listings/')), /identifiers=/);
  assert.equal(amazonHost({}), 'https://sellingpartnerapi-eu.amazon.com');
});

test('a sandbox success does not stay connected after the form is saved as live', async () => {
  const row = await run(() => upsertConnection(tenant._id, null, 'amazon', {
    credentials: { apiMode: 'sandbox', sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's' },
  }));
  await run(() => recordTest(row, { ok: true, message: 'Amazon sandbox refresh token exchanged and the sandbox orders call returned.' }));
  const saved = await run(() => upsertConnection(tenant._id, null, 'amazon', {
    credentials: { apiMode: 'live' },
  }));
  assert.equal(saved.lastTestOk, false);
  assert.equal(saved.status, 'saved');
  assert.match(saved.lastTestMessage, /Live is not connected/);
  assert.equal(credsOf(saved).apiMode, 'live');
  assert.equal(credsOf(saved).refreshToken, 'r');
});

test('amazon live test calls the live host and a sandbox token does not count as connected', async () => {
  const urls = [];
  const request = async (_method, url) => {
    urls.push(url);
    if (String(url).includes('/auth/o2/token')) return { status: 200, text: JSON.stringify({ access_token: 'tok' }) };
    return { status: 403, text: JSON.stringify({ errors: [{ message: 'Access to requested resource is denied.' }] }) };
  };
  const creds = { apiMode: 'live', sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's', marketplaceId: 'A21TJRUUN4KGV' };
  const live = await probeConnection(creds, { request });
  assert.equal(live.ok, false);
  assert.match(live.message, /live API returned 403/);
  assert.match(urls.find((url) => url.includes('/orders/')), /^https:\/\/sellingpartnerapi-eu\.amazon\.com/);
});
