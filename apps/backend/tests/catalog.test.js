process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const Product = require('../src/models/Product');
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

test('a Shopify store with more than 10,000 products is pulled to the last page', async () => {
  const total = 51;
  let calls = 0;
  const request = async (url) => {
    if (url.includes('/locations.json')) return { status: 200, text: '{"locations":[]}', headers: {} };
    calls += 1;
    const page = calls;
    return {
      status: 200,
      text: JSON.stringify({ products: [{ id: page, title: `P${page}`, variants: [{ id: page, sku: `SKU-${page}` }] }] }),
      headers: page < total ? { link: `<https://shop.example/admin/api/2024-10/products.json?page_info=p${page + 1}&limit=250>; rel="next"` } : {},
    };
  };
  const pulled = await pullCatalog({ shopUrl: 'shop.example', adminToken: 'shpat_test' }, { request });
  assert.equal(pulled.rows.length, total);
  assert.equal(pulled.rows.at(-1).channelSkuCode, `SKU-${total}`);
});

test('each Shopify variant keeps its own photo on the order line', async () => {
  const { imagesBySku, paintOrder } = require('../src/lib/catalogImages');
  const red = 'https://cdn.shopify.com/s/files/dupatta-design-14-red.jpg';
  const green = 'https://cdn.shopify.com/s/files/dupatta-design-7-green.jpg';
  const variants = [
    { channelSkuCode: 'DUP-PR14', channelVariantId: 'var-14', channelProductId: 'prod-dupatta', channelTitle: 'Paithani Dupatta / Design-14', image: red },
    { channelSkuCode: 'DUP-PR7', channelVariantId: 'var-7', channelProductId: 'prod-dupatta', channelTitle: 'Paithani Dupatta / Design-7', image: green },
  ];
  await run(() => importChannel(tenant._id, null, 'shopify', variants));
  const order = {
    items: [{ sku: 'DUP-PR14', name: 'Paithani Dupatta' }, { sku: 'DUP-PR7', name: 'Paithani Dupatta' }],
    subOrders: [{ sku: 'DUP-PR14', title: 'Paithani Dupatta' }, { sku: 'DUP-PR7', title: 'Paithani Dupatta' }],
  };
  const bySku = await imagesBySku(tenant._id, ['DUP-PR14', 'DUP-PR7']);
  const painted = paintOrder(order, bySku);
  assert.deepEqual(painted.items.map((item) => item.imageUrl), [red, green]);
  assert.deepEqual(painted.subOrders.map((sub) => sub.imageUrl), [red, green]);

  const pink = 'https://cdn.shopify.com/s/files/dupatta-design-7-pink.jpg';
  await run(() => importChannel(tenant._id, null, 'shopify', [{ ...variants[1], image: pink }]));
  const again = await imagesBySku(tenant._id, ['DUP-PR7']);
  assert.equal(paintOrder({ items: [{ sku: 'DUP-PR7' }] }, again).items[0].imageUrl, pink);
});

test('Shopify pull brings vendor, category and HSN onto the product, and a blank Shopify HSN stays blank', async () => {
  const urls = [];
  const request = async (url) => {
    urls.push(url);
    if (url.includes('/products.json')) {
      return {
        status: 200,
        headers: {},
        text: JSON.stringify({ products: [{
          id: 70,
          title: 'Banarasi Suit',
          vendor: 'Leheriya Weaves',
          product_type: 'Salwar Suit',
          variants: [
            { id: 71, sku: 'BAN-S', title: 'S', inventory_item_id: 801 },
            { id: 72, sku: 'BAN-M', title: 'M', inventory_item_id: 802 },
          ],
        }] }),
      };
    }
    if (url.includes('/locations.json')) return { status: 200, headers: {}, text: '{"locations":[]}' };
    if (url.includes('/inventory_items.json')) {
      return {
        status: 200,
        headers: {},
        text: JSON.stringify({ inventory_items: [
          { id: 801, harmonized_system_code: '62044390' },
          { id: 802, harmonized_system_code: null },
        ] }),
      };
    }
    return { status: 404, headers: {}, text: '{}' };
  };
  const pulled = await pullCatalog({ shopUrl: 'shop.example', adminToken: 'shpat_test' }, { request });
  assert.match(urls.find((url) => url.includes('/inventory_items.json')), /ids=801%2C802|ids=801,802/);
  assert.deepEqual(pulled.rows.map((row) => [row.vendor, row.category, row.hsnCode]), [
    ['Leheriya Weaves', 'Salwar Suit', '62044390'],
    ['Leheriya Weaves', 'Salwar Suit', ''],
  ]);

  const shop = await Tenant.create({ name: 'Vendor shop', slug: `vend-${Date.now()}`, kind: 'merchant' });
  const runShop = (work) => als.run({ tenantId: String(shop._id), skipTenantFilter: false }, work);
  await runShop(() => importChannel(shop._id, null, 'shopify', [pulled.rows[1]]));
  let product = await Product.findOne({ tenantId: shop._id });
  assert.equal(product.brand, 'Leheriya Weaves');
  assert.equal(product.category, 'Salwar Suit');
  assert.equal(product.hsnCode, '');

  await runShop(() => importChannel(shop._id, null, 'shopify', [
    { ...pulled.rows[1], vendor: 'Leheriya Studio', category: 'Suit Set', hsnCode: '62044290' },
  ]));
  product = await Product.findById(product._id);
  assert.equal(product.brand, 'Leheriya Studio');
  assert.equal(product.category, 'Suit Set');
  assert.equal(product.hsnCode, '62044290');

  await runShop(() => importChannel(shop._id, null, 'shopify', [{ ...pulled.rows[1], hsnCode: '' }]));
  product = await Product.findById(product._id);
  assert.equal(product.hsnCode, '62044290');
});

test('a Shopify re-pull replaces a stale product photo, but keeps a photo uploaded in OMSKing', async () => {
  const oldPhoto = 'https://cdn.shopify.com/s/files/abl-hand-painted-old.jpg';
  const newPhoto = 'https://cdn.shopify.com/s/files/abl-hand-painted-new.jpg';
  const shopifyProduct = (src) => ({
    id: 90,
    title: 'Premium Cotton Hand Painted 3 Pc Salwar Suit',
    image: { id: 1, src },
    images: [{ id: 1, src }],
    variants: [{ id: 91, sku: 'LEH-ABL186', title: 'Default Title' }],
  });
  const [first] = variantRows(shopifyProduct(oldPhoto));
  assert.equal(first.productImage, oldPhoto);

  const shop = await Tenant.create({ name: 'Photo shop', slug: `photo-${Date.now()}`, kind: 'merchant' });
  const runShop = (work) => als.run({ tenantId: String(shop._id), skipTenantFilter: false }, work);
  await runShop(() => importChannel(shop._id, null, 'shopify', [first]));
  let product = await Product.findOne({ tenantId: shop._id });
  assert.deepEqual(product.images, [oldPhoto]);

  const [repulled] = variantRows(shopifyProduct(newPhoto));
  await runShop(() => importChannel(shop._id, null, 'shopify', [repulled]));
  product = await Product.findById(product._id);
  assert.deepEqual(product.images, [newPhoto]);

  product.images = ['/uploads/products/own-photo.jpg'];
  await product.save();
  await runShop(() => importChannel(shop._id, null, 'shopify', [first]));
  product = await Product.findById(product._id);
  assert.deepEqual(product.images, ['/uploads/products/own-photo.jpg']);
});

test('each unmapped listing says why, checked against the real Master SKUs', async () => {
  const { explainUnmapped, unmapListing } = require('../src/services/catalogMapping.service');
  const shop = await Tenant.create({ name: 'Why unmapped', slug: `why-${Date.now()}`, kind: 'merchant' });
  const runShop = (work) => als.run({ tenantId: String(shop._id), skipTenantFilter: false }, work);
  const amazonRows = [
    { channelSkuCode: 'LEH-KDS189', channelVariantId: 'amz-none', channelTitle: 'No master' },
    { channelSkuCode: 'LEH-LATE-1', channelVariantId: 'amz-late', channelTitle: 'Master made later' },
    { channelSkuCode: 'AMZ-BAR-1', channelVariantId: 'amz-bar', channelTitle: 'Barcode twin', barcode: '8902222222222' },
    { channelSkuCode: 'LEH-OLD-1', channelVariantId: 'amz-old', channelTitle: 'Discontinued master' },
    { channelSkuCode: 'LEH-HAND-1', channelVariantId: 'amz-hand', channelTitle: 'Unmapped by hand' },
  ];
  await runShop(() => MasterSku.create({ tenantId: shop._id, code: 'LEH-OLD-1', name: 'Old', status: 'discontinued' }));
  await runShop(() => MasterSku.create({ tenantId: shop._id, code: 'LEH-HAND-1', name: 'Hand' }));
  const first = await runShop(() => importChannel(shop._id, null, 'amazon', amazonRows));
  assert.equal(first.unmapped, 4);
  assert.equal(first.autoMapped, 1);
  const hand = await SkuMapping.findOne({ tenantId: shop._id, channelVariantId: 'amz-hand' });
  await runShop(() => unmapListing(shop._id, null, hand));

  await runShop(() => MasterSku.create({ tenantId: shop._id, code: 'LEH-LATE-1', name: 'Late' }));
  await runShop(() => MasterSku.create({ tenantId: shop._id, code: 'SHOP-OTHER', name: 'Other', barcode: '8902222222222' }));

  const rows = await SkuMapping.find({ tenantId: shop._id, syncStatus: 'unmapped' });
  assert.equal(rows.length, 5);
  const why = await runShop(() => explainUnmapped(shop._id, rows));
  const of = (variant) => why.get(String(rows.find((row) => row.channelVariantId === variant)._id));

  assert.equal(of('amz-none').suggestedMasterSku, null);
  assert.match(of('amz-none').reason, /No Master SKU has code LEH-KDS189/);
  assert.match(of('amz-none').reason, /amazon sent no barcode/);

  assert.equal(of('amz-late').suggestedMasterSku, 'LEH-LATE-1');
  assert.match(of('amz-late').reason, /Master SKU LEH-LATE-1 has the same code/);

  assert.equal(of('amz-bar').suggestedMasterSku, 'SHOP-OTHER');
  assert.match(of('amz-bar').reason, /barcode 8902222222222/);

  assert.equal(of('amz-old').suggestedMasterSku, null);
  assert.match(of('amz-old').reason, /LEH-OLD-1 is discontinued/);

  assert.equal(of('amz-hand').suggestedMasterSku, 'LEH-HAND-1');
  assert.match(of('amz-hand').reason, /Master SKU LEH-HAND-1 has the same code/);

  const { listMappings } = require('../src/controllers/skuMappings.controller');
  let body;
  const res = { status() { return this; }, json(payload) { body = payload; return this; } };
  await runShop(() => listMappings({ tenantId: shop._id, query: { tab: 'unmapped', page: 1, limit: 50 } }, res));
  assert.equal(body.data.length, 5);
  const listed = body.data.find((row) => row.channelSku === 'LEH-LATE-1');
  assert.equal(listed.suggestedMasterSku, 'LEH-LATE-1');
  assert.match(listed.unmappedReason, /same code/);
});
