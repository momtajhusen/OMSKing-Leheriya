process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const { upsertConnection } = require('../src/services/channelConnection.service');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('pullOrdersNow ingests recent Shopify orders without the job queue', async () => {
  const { pullOrdersNow } = require('../src/services/orderPullNow.service');
  const tenant = await Tenant.create({ name: 'Pull now', slug: `pull-${Date.now()}`, kind: 'merchant' });
  const id = String(tenant._id);
  await upsertConnection(id, null, 'shopify', {
    credentials: { shopUrl: 'pull-now.myshopify.com', adminToken: 'shpat_test', apiMode: 'live' },
  });

  const shopify = require('../src/adapters/shopify');
  const original = shopify.pullOrders;
  shopify.pullOrders = async () => ([{
    externalOrderId: '991122',
    channelOrderNo: '#70082-LEH',
    status: 'New',
    paymentMode: 'COD',
    total: 2199,
    customer: 'Kavita',
    items: [{ sku: 'LEHSF69', name: 'Suit', qty: 1, price: 2199 }],
    orderDate: new Date(),
  }]);

  try {
    const results = await als.run({ tenantId: id, skipTenantFilter: false }, () =>
      pullOrdersNow(tenant._id, { hours: 48, channels: ['shopify'] }),
    );
    assert.equal(results[0].status, 'success');
    assert.equal(results[0].created, 1);
    const order = await Order.findOne({ tenantId: tenant._id, channelOrderNo: '#70082-LEH' });
    assert.ok(order);
    assert.equal(order.orderNo, 'SHP-991122');
  } finally {
    shopify.pullOrders = original;
  }
});
