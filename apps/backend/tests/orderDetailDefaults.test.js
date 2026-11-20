process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const orders = require('../src/controllers/orders.controller');

let memory;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function asTenant(tenantId, fn) {
  return als.run({ tenantId: String(tenantId), skipTenantFilter: false }, fn);
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('GET order shows package defaults and Tax default HSN when line/master HSN is blank', async () => {
  const tenant = await Tenant.create({
    name: 'Defaults Co',
    slug: `def-vis-${Date.now()}`,
    kind: 'merchant',
    settings: {
      packageDefaults: { weightKg: 0.45, lengthCm: 10, breadthCm: 10, heightCm: 10 },
      taxGst: { defaultHsn: '5407' },
    },
  });
  const product = await Product.create({
    tenantId: tenant._id, name: 'Dress', status: 'active', hsnCode: '',
  });
  const master = await MasterSku.create({
    tenantId: tenant._id, code: 'DEF-SKU', name: 'Dress', productId: product._id,
    weightKg: 0, dimensionsCm: { l: 0, w: 0, h: 0 }, hsnCode: '',
  });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-DEF-1',
    channel: 'Shopify',
    channelOrderNo: '#90001-LEH',
    status: 'New',
    customer: 'Buyer',
    items: [{
      name: 'Dress', sku: 'DEF-SKU', qty: 1, price: 1000,
      masterSkuId: master._id, hsn: '',
      pack: { weightKg: 0, lengthCm: 0, breadthCm: 0, heightCm: 0 },
    }],
    source: 'manual',
  });

  const res = fakeRes();
  await asTenant(tenant._id, () => orders.getOrder({
    params: { orderId: 'SHP-DEF-1' },
    tenantId: String(tenant._id),
    user: { id: 'u1', role: 'super_admin' },
    vendorScope: { active: false },
  }, res));

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const item = res.body.data.items[0];
  assert.equal(item.hsn, '5407');
  assert.equal(item.package.weightKg, 0.45);
  assert.equal(item.package.lengthCm, 10);
  assert.equal(item.package.source, 'default');
});

test('GET order by channel order number still returns package + HSN', async () => {
  const tenant = await Tenant.create({
    name: 'Channel Co',
    slug: `ch-vis-${Date.now()}`,
    kind: 'merchant',
    settings: { taxGst: { defaultHsn: '6109' } },
  });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-CH-1',
    channel: 'Shopify',
    channelOrderNo: '#70082-LEH',
    status: 'New',
    items: [{ name: 'Item', sku: 'X1', qty: 1, price: 100, hsn: '' }],
    source: 'manual',
  });
  const res = fakeRes();
  await asTenant(tenant._id, () => orders.getOrder({
    params: { orderId: '70082-LEH' },
    tenantId: String(tenant._id),
    user: { id: 'u1', role: 'super_admin' },
    vendorScope: { active: false },
  }, res));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.id, 'SHP-CH-1');
  assert.equal(res.body.data.items[0].hsn, '6109');
  assert.equal(res.body.data.items[0].package.weightKg, 0.45);
});
