'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const CustomerReturn = require('../src/models/CustomerReturn');
const { listReturns } = require('../src/services/returnsFlow.service');

let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

test('return list sends a numeric amount from the order item prices of the returned lines', async () => {
  const tenant = await Tenant.create({ name: 'Return shop', slug: `retamt-${Date.now()}`, kind: 'merchant' });
  const other = await Tenant.create({ name: 'Other shop', slug: `retamt-o-${Date.now()}`, kind: 'merchant' });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-5001',
    channel: 'Shopify',
    status: 'Delivered',
    items: [
      { sku: 'KURTA', qty: 2, price: 1200 },
      { sku: 'SAREE', qty: 1, price: 3000 },
    ],
  });
  await Order.create({
    tenantId: other._id,
    orderNo: 'SHP-5002',
    channel: 'Shopify',
    status: 'Delivered',
    items: [{ sku: 'KURTA', qty: 1, price: 9999 }],
  });
  await CustomerReturn.create([
    { tenantId: tenant._id, returnNo: 'SHP-RET-1', orderNo: 'SHP-5001', items: [{ sku: 'KURTA', qty: 2 }, { sku: 'SAREE', qty: 1 }] },
    { tenantId: tenant._id, returnNo: 'SHP-RET-2', orderNo: 'SHP-5001', items: [{ sku: 'KURTA', qty: 1 }] },
    { tenantId: tenant._id, returnNo: 'SHP-RET-3', orderNo: 'SHP-5002', items: [{ sku: 'KURTA', qty: 1 }] },
  ]);

  const rows = await listReturns(tenant._id);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row.amount]));
  assert.equal(byId['SHP-RET-1'], 5400);
  assert.equal(byId['SHP-RET-2'], 1200);
  assert.equal(byId['SHP-RET-3'], 0, 'another company\'s order price must not leak into this return');
  for (const row of rows) assert.equal(Number.isFinite(row.amount), true);
});
