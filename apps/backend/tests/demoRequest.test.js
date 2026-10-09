process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const DemoRequest = require('../src/models/DemoRequest');
const { createDemoRequest } = require('../src/controllers/demoRequest.controller');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

function callCreate(body) {
  return new Promise((resolve, reject) => {
    const req = { body };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    createDemoRequest(req, res).catch(reject);
  });
}

test('a demo request stores company details and does not open an account', async () => {
  const email = `demo-${Date.now()}@example.com`;
  const created = await callCreate({
    name: 'Demo Buyer',
    email,
    phone: '9876543210',
    company: 'Demo Cloth House',
    city: 'Jaipur',
    monthlyOrders: '500-2000',
    channels: ['Shopify', 'Amazon'],
    message: 'Show warehouse split',
  });
  assert.equal(created.status, 201);
  const row = await DemoRequest.findOne({ email });
  assert.equal(row.company, 'Demo Cloth House');
  assert.deepEqual(row.channels, ['Shopify', 'Amazon']);
  const again = await callCreate({
    name: 'Demo Buyer',
    email,
    phone: '9876543210',
    company: 'Demo Cloth House',
    monthlyOrders: '500-2000',
    channels: ['Shopify'],
  });
  assert.equal(again.status, 200);
  assert.equal(await DemoRequest.countDocuments({ email }), 1);
});
