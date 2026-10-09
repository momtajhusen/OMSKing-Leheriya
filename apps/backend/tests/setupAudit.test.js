process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const AuditLog = require('../src/models/AuditLog');
const MasterSku = require('../src/models/MasterSku');
const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const settings = require('../src/controllers/settings.controller');
const orders = require('../src/controllers/orders.controller');

let memory;
let tenant;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(handler, req = {}) {
  const res = fakeRes();
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false, userId: null }, () => handler({
    tenantId: String(tenant._id),
    user: { id: null, role: 'super_admin' },
    params: {},
    query: {},
    body: {},
    headers: {},
    ...req,
  }, res));
  return res.body?.data;
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await AuditLog.syncIndexes();
  tenant = await Tenant.create({ name: 'Tax shop', slug: `tax-${Date.now()}`, kind: 'merchant' });
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('tax settings persist, HSN updates a SKU, and the audit row keeps before and after', async () => {
  const loaded = await call(settings.getTax);
  assert.equal(loaded.defaultGstRate, 18);
  assert.equal(loaded.categories.length, 3);
  assert.equal(loaded.saved, false);

  const saved = await call(settings.patchTax, {
    body: {
      defaultGstRate: 12,
      categories: [
        { name: 'Clothing (Below ₹1000)', gstRate: 5 },
        { name: 'Clothing (Above ₹1000)', gstRate: 12 },
      ],
    },
  });
  assert.equal(saved.defaultGstRate, 12);
  assert.equal(saved.saved, true);

  const again = await call(settings.getTax);
  assert.equal(again.defaultGstRate, 12);
  assert.equal(again.categories.length, 2);

  const same = await call(settings.patchTax, {
    body: { defaultGstRate: 12, categories: again.categories },
  });
  assert.equal(same.defaultGstRate, 12);

  const product = await Product.create({ tenantId: tenant._id, name: 'Kurta', hsnCode: '', gstRatePercent: 5 });
  await MasterSku.create({
    tenantId: tenant._id,
    productId: product._id,
    code: 'KURTA1',
    name: 'Kurta',
  });
  const uploaded = await call(settings.uploadHsn, {
    body: { rows: [{ hsn: '6109', description: 'T-shirts', gstRate: 5, sku: 'KURTA1' }, { hsn: '6204', description: 'Suits', gstRate: 12 }] },
  });
  assert.equal(uploaded.hsnCount, 2);
  assert.equal(uploaded.appliedCount, 1);
  const sku = await MasterSku.findOne({ tenantId: tenant._id, code: 'KURTA1' });
  assert.equal(sku.hsnCode, '6109');
  assert.equal(sku.gstRatePercent, 5);
  const freshProduct = await Product.findById(product._id);
  assert.equal(freshProduct.hsnCode, '6109');

  await Order.create({
    tenantId: tenant._id,
    orderNo: 'ORD-TAX-1',
    source: 'manual',
    status: 'New',
    customer: 'Buyer',
  });
  const dto = await call(orders.patchStatus, { params: { orderId: 'ORD-TAX-1' }, body: { status: 'Packed' } });
  assert.equal(dto.status, 'Packed');

  const logs = await AuditLog.find({ tenantId: tenant._id }).sort({ createdAt: 1 }).setOptions({ skipTenantFilter: true });
  const actions = logs.map((row) => row.action);
  assert.deepEqual(actions, ['tax.updated', 'tax.hsn_uploaded', 'order.status_updated']);
  const taxLog = logs[0];
  const rate = taxLog.changes.find((change) => change.field === 'defaultGstRate');
  assert.equal(rate.before, 18);
  assert.equal(rate.after, 12);
  const status = logs[2].changes.find((change) => change.field === 'status');
  assert.equal(status.before, 'New');
  assert.equal(status.after, 'Packed');
  assert.equal(logs[2].resourceDisplay, 'ORD-TAX-1');
  assert.equal(JSON.stringify(logs).includes('Buyer'), false);

  await assert.rejects(
    () => AuditLog.updateOne({ _id: taxLog._id }, { action: 'tampered' }),
    /append-only/,
  );
});
