process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const Inventory = require('../src/models/Inventory');
const InventoryLedger = require('../src/models/InventoryLedger');
const Warehouse = require('../src/models/Warehouse');
const Vendor = require('../src/models/Vendor');
const { parseCsv } = require('../src/services/catalogMapping.service');
const { importListings } = require('../src/controllers/skuMappings.controller');
const orders = require('../src/controllers/orders.controller');
const { ingestChannelOrders } = require('../src/services/channelOrder.service');
const { paintOrder } = require('../src/lib/catalogImages');

let memory;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(tenant, handler, req = {}) {
  const res = fakeRes();
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false }, () => handler({
    tenantId: String(tenant._id),
    user: { id: null, role: 'super_admin' },
    params: {},
    query: {},
    body: {},
    ...req,
  }, res));
  return res.body;
}

async function importCsv(tenant, channel, csv) {
  const body = await call(tenant, importListings, { body: { channel, csv } });
  return body.data;
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await Promise.all([
    MasterSku.syncIndexes(),
    SkuMapping.syncIndexes(),
    Order.syncIndexes(),
    Inventory.syncIndexes(),
  ]);
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('Shopify CSV creates one master per SKU and a repeat row does not add another', async () => {
  const tenant = await Tenant.create({ name: 'CSV shop', slug: `csv-${Date.now()}`, kind: 'merchant' });
  const csv = [
    'sku,title,barcode,price,image,channelVariantId',
    'BANDH-1,Blue bandhani,8901000000001,1000,https://cdn.shopify.com/s/files/bandh.jpg,shop-1',
    'BANDH-2,Red bandhani,8901000000002,1200,https://cdn.shopify.com/s/files/red.jpg,shop-2',
    'BANDH-1,Blue bandhani,8901000000001,1000,https://picsum.photos/200,shop-1',
  ].join('\n');
  assert.equal(parseCsv(csv).length, 3);
  const summary = await importCsv(tenant, 'shopify', csv);
  assert.equal(summary.created, 2);
  assert.equal(summary.exists, 1);
  const masters = await MasterSku.find({ tenantId: tenant._id }).sort({ code: 1 });
  assert.deepEqual(masters.map((row) => row.code), ['BANDH-1', 'BANDH-2']);
  const product = await Product.findOne({ tenantId: tenant._id, name: 'Blue bandhani' });
  assert.equal(product.images[0], 'https://cdn.shopify.com/s/files/bandh.jpg');
});

test('the same Myntra SKU maps to the Shopify master', async () => {
  const tenant = await Tenant.findOne({ name: 'CSV shop' });
  const before = await MasterSku.countDocuments({ tenantId: tenant._id });
  const summary = await importCsv(tenant, 'myntra', [
    'sku,title,channelVariantId',
    'BANDH-1,Blue bandhani,myn-1',
  ].join('\n'));
  assert.equal(summary.autoMapped, 1);
  assert.equal(summary.created, 0);
  assert.equal(summary.rows[0].masterSku, 'BANDH-1');
  assert.equal(await MasterSku.countDocuments({ tenantId: tenant._id }), before);
});

test('an Amazon line that does not match stays unmapped and does not lock stock', async () => {
  const tenant = await Tenant.findOne({ name: 'CSV shop' });
  const master = await MasterSku.findOne({ tenantId: tenant._id, code: 'BANDH-1' });
  const warehouse = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Physical',
    type: 'physical',
    isDefault: true,
    status: 'active',
    sellOnShopify: true,
    sellOnAmazon: true,
    sellOnMyntra: true,
  });
  await Inventory.create({
    tenantId: tenant._id,
    masterSkuId: master._id,
    warehouseId: warehouse._id,
    physicalQty: 4,
    virtualQty: 0,
    reservedQty: 0,
  });
  const summary = await importCsv(tenant, 'amazon', [
    'sku,title,channelVariantId',
    'AMZ-NO-HIT,Unknown piece,amz-x',
  ].join('\n'));
  assert.equal(summary.unmapped, 1);
  assert.equal(summary.created, 0);
  const mapping = await SkuMapping.findOne({ tenantId: tenant._id, channel: 'amazon', channelSkuCode: 'AMZ-NO-HIT' });
  assert.equal(mapping.syncStatus, 'unmapped');
  assert.equal(mapping.masterSkuId, null);

  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false }, () => ingestChannelOrders(tenant._id, 'amazon', [{
    externalOrderId: '111-222',
    status: 'New',
    total: 100,
    items: [{ sku: 'AMZ-NO-HIT', name: 'Unknown piece', qty: 1, price: 100, imageUrl: 'https://picsum.photos/200' }],
  }]));
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'AMZ-111-222' });
  assert.equal(order.items[0].masterSkuId, null);
  assert.equal(order.reserveState, 'unmapped');
  const stock = await Inventory.findOne({ tenantId: tenant._id, masterSkuId: master._id });
  assert.equal(stock.reservedQty, 0);
  assert.equal(stock.physicalQty, 4);
  assert.equal(await InventoryLedger.countDocuments({ tenantId: tenant._id, movementType: 'order_reserve' }), 0);
  assert.equal(await MasterSku.countDocuments({ tenantId: tenant._id, code: 'AMZ-NO-HIT' }), 0);
});

test('Shopify then Myntra then Amazon with one seller SKU is one master', async () => {
  const tenant = await Tenant.create({ name: 'Fresh catalog', slug: `fresh-${Date.now()}`, kind: 'merchant' });
  const row = (variant) => [
    'sku,title,barcode,price,image,channelVariantId',
    `SELLER-1,Same kurta,8901999888777,1500,https://cdn.shopify.com/s/files/seller.jpg,${variant}`,
  ].join('\n');
  const shopify = await importCsv(tenant, 'shopify', row('shop'));
  const myntra = await importCsv(tenant, 'myntra', row('myn'));
  const amazon = await importCsv(tenant, 'amazon', row('amz'));
  assert.equal(shopify.created, 1);
  assert.equal(myntra.autoMapped, 1);
  assert.equal(myntra.created, 0);
  assert.equal(amazon.autoMapped, 1);
  assert.equal(amazon.created, 0);
  const masters = await MasterSku.find({ tenantId: tenant._id });
  assert.deepEqual(masters.map((item) => item.code), ['SELLER-1']);
  const channels = await SkuMapping.find({ tenantId: tenant._id, masterSkuId: masters[0]._id });
  assert.deepEqual(channels.map((item) => item.channel).sort(), ['amazon', 'myntra', 'shopify']);
});

test('an unmapped order cannot be packed, and after mapping it can go to pack or vendor', async () => {
  const tenant = await Tenant.create({ name: 'Pack map', slug: `pmap-${Date.now()}`, kind: 'merchant' });
  const warehouse = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Physical',
    type: 'physical',
    isDefault: true,
    status: 'active',
    sellOnShopify: true,
    sellOnAmazon: true,
    sellOnMyntra: true,
  });
  await Vendor.create({ tenantId: tenant._id, name: 'Loom House', nameNorm: 'loom house', phone: '9811100099' });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-MAP-1',
    channel: 'Shopify',
    source: 'manual',
    customer: 'Asha',
    status: 'New',
    paymentMode: 'Prepaid',
    total: 1000,
    items: [{
      name: 'Blue bandhani',
      sku: 'BANDH-9',
      qty: 1,
      price: 1000,
      imageUrl: 'https://picsum.photos/200',
    }],
    subOrders: [{ id: 'SHP-MAP-1-1', index: 1, sku: 'BANDH-9', title: 'Blue bandhani', qty: 1, price: 1000, imageUrl: 'https://picsum.photos/200' }],
    channelLines: [{ sellerOrderId: 'SO-9', sku: 'BANDH-9', imageUrl: 'https://picsum.photos/200', status: 'New' }],
  });

  await assert.rejects(
    () => call(tenant, orders.patchStatus, { params: { orderId: 'SHP-MAP-1' }, body: { status: 'Ready to Ship' } }),
    /Map the SKU before this order can be packed/,
  );
  await assert.rejects(
    () => call(tenant, orders.assignSubOrder, {
      params: { orderId: 'SHP-MAP-1', subOrderId: 'SHP-MAP-1-1' },
      body: { assignedVendor: 'Loom House' },
    }),
    /Map the SKU before this line can go to a vendor/,
  );

  await importCsv(tenant, 'shopify', [
    'sku,title,price,image,channelVariantId',
    'BANDH-9,Blue bandhani,1000,https://cdn.shopify.com/s/files/bandh9.jpg,shop-9',
  ].join('\n'));

  const linked = await Order.findOne({ tenantId: tenant._id, orderNo: 'SHP-MAP-1' });
  const master = await MasterSku.findOne({ tenantId: tenant._id, code: 'BANDH-9' });
  assert.equal(String(linked.items[0].masterSkuId), String(master._id));
  assert.equal(String(linked.subOrders[0].masterSkuId), String(master._id));
  await Inventory.create({
    tenantId: tenant._id,
    masterSkuId: master._id,
    warehouseId: warehouse._id,
    physicalQty: 1,
    virtualQty: 0,
    reservedQty: 0,
  });

  const packedView = await call(tenant, orders.getOrder, { params: { orderId: 'SHP-MAP-1' } });
  assert.equal(packedView.data.mappingFailed, false);
  assert.equal(packedView.data.fulfilmentSource, 'Offline');
  assert.match(packedView.data.routeNote, /WH-001 pack/);
  assert.equal(packedView.data.items[0].imageUrl, 'https://cdn.shopify.com/s/files/bandh9.jpg');
  assert.equal(packedView.data.subOrders[0].imageUrl, 'https://cdn.shopify.com/s/files/bandh9.jpg');
  assert.equal(packedView.data.channelLines[0].imageUrl, 'https://cdn.shopify.com/s/files/bandh9.jpg');

  const packed = await call(tenant, orders.patchStatus, { params: { orderId: 'SHP-MAP-1' }, body: { status: 'Ready to Ship' } });
  assert.equal(packed.data.status, 'Ready to Ship');

  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-MAP-2',
    channel: 'Shopify',
    source: 'manual',
    customer: 'Meera',
    status: 'New',
    paymentMode: 'Prepaid',
    total: 1000,
    items: [{ name: 'Blue bandhani', sku: 'BANDH-9', qty: 1, price: 1000, masterSkuId: master._id }],
    subOrders: [{ id: 'SHP-MAP-2-1', index: 1, sku: 'BANDH-9', title: 'Blue bandhani', qty: 1, price: 1000, masterSkuId: master._id }],
  });
  await Inventory.updateOne({ tenantId: tenant._id, masterSkuId: master._id }, { $set: { physicalQty: 0 } });
  const vendorView = await call(tenant, orders.getOrder, { params: { orderId: 'SHP-MAP-2' } });
  assert.equal(vendorView.data.fulfilmentSource, 'Virtual');
  const assigned = await call(tenant, orders.assignSubOrder, {
    params: { orderId: 'SHP-MAP-2', subOrderId: 'SHP-MAP-2-1' },
    body: { assignedVendor: 'Loom House' },
  });
  assert.equal(assigned.data.subOrders[0].assignedVendor, 'Loom House');
});

test('a placeholder image does not replace a real product photo', () => {
  const real = 'https://cdn.shopify.com/s/files/bandh.jpg';
  const painted = paintOrder({
    items: [{ sku: 'BANDH-1', imageUrl: real }],
    subOrders: [{ sku: 'BANDH-1', imageUrl: real }],
    channelLines: [{ sku: 'BANDH-1', imageUrl: real }],
  }, new Map([['bandh-1', 'https://picsum.photos/200']]));
  assert.equal(painted.items[0].imageUrl, real);
  assert.equal(painted.subOrders[0].imageUrl, real);
  assert.equal(painted.channelLines[0].imageUrl, real);

  const replaced = paintOrder({
    items: [{ sku: 'BANDH-1', imageUrl: 'https://picsum.photos/200' }],
    subOrders: [{ sku: 'BANDH-1', imageUrl: 'https://via.placeholder.com/200' }],
    channelLines: [{ sku: 'BANDH-1', imageUrl: '' }],
  }, new Map([['bandh-1', real]]));
  assert.equal(replaced.items[0].imageUrl, real);
  assert.equal(replaced.subOrders[0].imageUrl, real);
  assert.equal(replaced.channelLines[0].imageUrl, real);
});
