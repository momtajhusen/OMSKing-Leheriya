process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const Order = require('../src/models/Order');
const SkuMapping = require('../src/models/SkuMapping');
const partner = require('../src/adapters/partner');
const { stockIn, channelAts } = require('../src/services/inventory.service');
const { ensureDefaultWarehouses } = require('../src/services/warehouse.service');
const { importChannel } = require('../src/services/catalogMapping.service');
const { ingestChannelOrders } = require('../src/services/channelOrder.service');

let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

test('partner API rows become listings, orders and offline ATS', async () => {
  const orders = await partner.pullOrders({
    apiBaseUrl: 'https://partner.example',
    apiToken: 'tok',
    supplierId: 'MSH1',
  }, {
    request: async (url, options) => {
      assert.equal(url, 'https://partner.example/orders');
      assert.equal(options.method, 'GET');
      assert.match(options.headers.Authorization, /^Bearer /);
      return {
        orders: [{
          orderId: '9001',
          status: 'Confirmed',
          total: 499,
          items: [{ sku: 'KURTA-1', name: 'Kurta', quantity: 1, price: 499 }],
        }],
      };
    },
  });
  assert.equal(orders[0].externalOrderId, '9001');
  assert.equal(orders[0].status, 'New');
  assert.equal(orders[0].items[0].sku, 'KURTA-1');

  const tenant = await Tenant.create({ name: 'Partner shop', slug: `partner-${Date.now()}`, kind: 'merchant' });
  const { physical, virtual } = await ensureDefaultWarehouses(tenant._id);
  const sku = await MasterSku.create({ tenantId: tenant._id, code: 'KURTA-1', name: 'Kurta' });
  await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: physical._id, qty: 4, reason: 'offline' });
  await stockIn(String(tenant._id), null, { masterSkuId: sku._id, warehouseId: virtual._id, qty: 1000, reason: 'virtual' });
  const ats = await channelAts(String(tenant._id), sku._id);
  assert.equal(ats.shopify, 1004);
  assert.equal(ats.meesho, 4);
  assert.equal(ats.flipkart, 4);
  assert.equal(ats.amazon, 4);
  assert.equal(ats.nykaa, 4);

  const imported = await importChannel(String(tenant._id), null, 'meesho', [{
    channelSkuCode: 'KURTA-1',
    channelTitle: 'Kurta',
    price: 499,
  }]);
  assert.equal(imported.failed, 0);
  const mapping = await SkuMapping.findOne({ tenantId: tenant._id, channel: 'meesho' });
  assert.equal(mapping.channelSkuCode, 'KURTA-1');

  const saved = await ingestChannelOrders(String(tenant._id), 'meesho', orders);
  assert.equal(saved.created, 1);
  const order = await Order.findOne({ tenantId: tenant._id, externalOrderId: '9001' });
  assert.equal(order.channel, 'Meesho');
  assert.equal(order.orderNo, 'MSH-9001');
  assert.equal(order.items[0].sku, 'KURTA-1');
});
