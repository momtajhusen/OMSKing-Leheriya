const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Product = require('../src/models/Product');
const MasterSku = require('../src/models/MasterSku');
const { list } = require('../src/controllers/inventory.controller');

let mongod;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

test.after(async () => {
  mongoose.set('debug', false);
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

function fakeRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('opening the inventory page reads product images only for the SKUs on that page', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Speed', slug: `speed-${stamp}`, kind: 'merchant' });
  for (let i = 0; i < 6; i += 1) {
    const product = await Product.create({ tenantId: tenant._id, name: `Suit ${i}`, images: [`https://img.test/suit-${i}.jpg`] });
    await MasterSku.create({ tenantId: tenant._id, productId: product._id, code: `SPD-${i}-${stamp}`, name: `Suit ${i}` });
  }
  const req = { tenantId: String(tenant._id), user: { tenantId: String(tenant._id) }, query: { page: '1', limit: '2' } };
  await list(req, fakeRes());

  const productReads = [];
  mongoose.set('debug', (collection, method, filter) => {
    if (collection === 'products' && method === 'find') productReads.push(filter || {});
  });
  const res = fakeRes();
  await list(req, res);
  mongoose.set('debug', false);

  const { rows } = res.body.data;
  assert.equal(res.body.meta.total, 12, 'six SKUs at two warehouses');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.imageUrl === 'https://img.test/suit-0.jpg'), 'page rows still show their product image');
  assert.equal(res.body.data.kpis.totalStock, 0);
  const askedIds = productReads.flatMap((filter) => filter._id?.$in || []);
  assert.equal(askedIds.length, 1, 'only the one product on this page is loaded, not the whole catalogue');
  assert.ok(productReads.every((filter) => String(filter.tenantId) === String(tenant._id)), 'product read is scoped to the tenant');
});
