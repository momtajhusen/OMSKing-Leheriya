process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ensurePricing, quoteOrders, savePricing } = require('../src/services/pricing.service');
const { createInquiry } = require('../src/controllers/pricing.controller');
const PricingInquiry = require('../src/models/PricingInquiry');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('a quiet month still meets the minimum and a large month uses the lowest per-order rate', async () => {
  const doc = await ensurePricing();
  const quiet = quoteOrders(100, doc);
  assert.equal(quiet.rate, 2);
  assert.equal(quiet.usage, 200);
  assert.equal(quiet.bill, 1000);
  assert.equal(quiet.adjustment, 800);

  const busy = quoteOrders(25000, doc);
  assert.equal(busy.rate, 0.75);
  assert.equal(busy.bill, 18750);
  assert.equal(busy.adjustment, 0);

  const saved = await savePricing({
    minimumMonthly: 500,
    slabs: [
      { upTo: 100, rate: 3 },
      { upTo: null, rate: 1 },
    ],
  });
  assert.equal(quoteOrders(10, saved).bill, 500);
  assert.equal(quoteOrders(200, saved).rate, 1);
  assert.equal(quoteOrders(200, saved).usage, 200);
  assert.equal(quoteOrders(200, saved).bill, 500);
  assert.equal(quoteOrders(600, saved).bill, 600);
});

test('a pricing request is stored in the database', async () => {
  const email = `price-${Date.now()}@example.com`;
  const created = await new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    createInquiry({ body: { name: 'Price Buyer', email, company: 'Rate Check', orders: '4000' } }, res).catch(reject);
  });
  assert.equal(created.status, 201);
  const row = await PricingInquiry.findOne({ email });
  assert.equal(row.company, 'Rate Check');
  assert.equal(row.orders, '4000');
});
