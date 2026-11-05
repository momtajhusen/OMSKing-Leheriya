process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const CourierAccount = require('../src/models/CourierAccount');
const { courierRates, rateEstimate } = require('../src/services/ship.service');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

async function seller(packageDefaults) {
  const n = new mongoose.Types.ObjectId().toString().slice(-6);
  return Tenant.create({ name: `Rates ${n}`, slug: `rates-${n}-${Date.now()}`, kind: 'merchant', settings: { packageDefaults } });
}

test('rate = per 0.5 kg rate × slabs of the heavier of actual and volumetric (L×B×H/5000) weight', () => {
  assert.deepEqual(rateEstimate(80, { weightGrams: 500, lengthCm: 30, breadthCm: 25, heightCm: 5 }), { chargeableKg: 0.75, slabs: 2, amount: 160 });
  assert.deepEqual(rateEstimate(80, { weightGrams: 1200, lengthCm: 10, breadthCm: 10, heightCm: 10 }), { chargeableKg: 1.2, slabs: 3, amount: 240 });
  assert.equal(rateEstimate(0, { weightGrams: 500 }), null, 'no rate saved → no estimate');
  assert.equal(rateEstimate(80, {}), null, 'no package → no estimate');
});

test('courier rates list only this company\'s enabled couriers, Delhivery first, with an estimate each', async () => {
  const tenant = await seller({ weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 5 });
  await CourierAccount.create([
    { tenantId: tenant._id, source: 'own', code: 'delhivery', name: 'Delhivery', status: 'active', rateHalfKg: 80 },
    { tenantId: tenant._id, source: 'own', code: 'bluedart', name: 'Bluedart', status: 'active', rateHalfKg: 100 },
    { tenantId: tenant._id, source: 'platform', code: 'ecom-express', name: 'Ecom Express', status: 'inactive', rateHalfKg: 70 },
    { tenantId: tenant._id, source: 'platform', code: 'xpressbees', name: 'Xpressbees', status: 'active', rateHalfKg: 0 },
  ]);
  await Order.create({ tenantId: tenant._id, orderNo: 'SHP-RATE-1', channel: 'Shopify', items: [{ sku: 'X', qty: 1 }] });

  const out = await courierRates(tenant._id, 'SHP-RATE-1');
  assert.deepEqual(out.package, { weightGrams: 500, lengthCm: 30, breadthCm: 25, heightCm: 5 });
  assert.deepEqual(out.couriers.map((c) => [c.code, c.estimate?.amount ?? null]), [
    ['delhivery', 160],
    ['bluedart', 200],
    ['xpressbees', null],
  ]);
  assert.equal(out.couriers.find((c) => c.code === 'ecom-express'), undefined, 'inactive courier is not offered');
});

test('another company\'s order gets no rates', async () => {
  const owner = await seller({ weightKg: 0.5, lengthCm: 10, breadthCm: 10, heightCm: 10 });
  const other = await seller({ weightKg: 0.5, lengthCm: 10, breadthCm: 10, heightCm: 10 });
  await Order.create({ tenantId: owner._id, orderNo: 'SHP-RATE-X', channel: 'Shopify', items: [{ sku: 'X', qty: 1 }] });
  await assert.rejects(() => courierRates(other._id, 'SHP-RATE-X'), (err) => err.statusCode === 404);
});
