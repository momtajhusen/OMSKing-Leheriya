process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Product = require('../src/models/Product');
const MasterSku = require('../src/models/MasterSku');

let memory;
const tenantId = new mongoose.Types.ObjectId();
const otherTenant = new mongoose.Types.ObjectId();
let productIds = [];

function stages(plan, out = []) {
  if (!plan || typeof plan !== 'object') return out;
  if (plan.stage) out.push(plan);
  ['inputStage', 'outerStage', 'innerStage'].forEach((key) => stages(plan[key], out));
  (plan.inputStages || []).forEach((child) => stages(child, out));
  return out;
}

function winning(explain) {
  const planner = explain.queryPlanner || explain[0]?.queryPlanner;
  return stages(planner.winningPlan.queryPlan || planner.winningPlan);
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await Promise.all([Product.syncIndexes(), MasterSku.syncIndexes()]);
  const products = [];
  [tenantId, otherTenant].forEach((tid) => {
    for (let i = 0; i < 60; i += 1) {
      products.push({ _id: new mongoose.Types.ObjectId(), tenantId: tid, name: `P${i}`, createdAt: new Date(Date.now() - i * 1000) });
    }
  });
  await Product.collection.insertMany(products);
  productIds = products.filter((p) => String(p.tenantId) === String(tenantId)).map((p) => p._id);
  const skus = [];
  products.forEach((p, pi) => {
    for (let v = 0; v < 8; v += 1) {
      skus.push({ tenantId: p.tenantId, productId: p._id, code: `SKU-${pi}-${v}`, name: `S${pi}-${v}`, barcode: '', status: 'active' });
    }
  });
  await MasterSku.collection.insertMany(skus);
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('Products list: variants of a page are read through a tenantId+productId index, not a scan of every tenant SKU', async () => {
  const pageIds = productIds.slice(0, 25);
  const explain = await MasterSku.find({ tenantId, productId: { $in: pageIds } })
    .setOptions({ skipTenantFilter: true })
    .explain('queryPlanner');
  const ixscans = winning(explain).filter((s) => s.stage === 'IXSCAN');
  assert.ok(ixscans.some((s) => s.keyPattern && 'productId' in s.keyPattern), JSON.stringify(ixscans.map((s) => s.indexName)));
  const rows = await MasterSku.find({ tenantId, productId: { $in: pageIds } }).setOptions({ skipTenantFilter: true });
  assert.equal(rows.length, 25 * 8);
  assert.ok(rows.every((row) => String(row.tenantId) === String(tenantId)));
});

test('Products list: newest-first page comes from a tenantId+createdAt index without an in-memory sort', async () => {
  const explain = await Product.find({ tenantId })
    .sort({ createdAt: -1 })
    .skip(25)
    .limit(25)
    .setOptions({ skipTenantFilter: true })
    .explain('queryPlanner');
  const plan = winning(explain);
  assert.ok(!plan.some((s) => s.stage === 'SORT'), JSON.stringify(plan.map((s) => s.stage)));
  assert.ok(plan.some((s) => s.stage === 'IXSCAN' && s.keyPattern && 'createdAt' in s.keyPattern));
  const rows = await Product.find({ tenantId }).sort({ createdAt: -1 }).skip(25).limit(25).setOptions({ skipTenantFilter: true });
  assert.deepEqual(rows.map((r) => String(r._id)), productIds.slice(25, 50).map(String));
});
