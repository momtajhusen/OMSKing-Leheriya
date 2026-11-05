process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { hashPassword } = require('../src/lib/password');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const Order = require('../src/models/Order');
const MasterSku = require('../src/models/MasterSku');
const app = require('../src/app');

let memory;
let server;
let base;

async function login(email) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).data.accessToken;
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenant = await Tenant.create({ name: 'Barcode Co', slug: `barcode-${Date.now()}`, kind: 'merchant', status: 'active' });
  const other = await Tenant.create({ name: 'Other Co', slug: `barcode-other-${Date.now()}`, kind: 'merchant', status: 'active' });
  const role = await Role.create({ tenantId: tenant._id, code: 'ops', name: 'ops', permissions: ['orders.view'], isSystem: true });
  await User.create({
    tenantId: tenant._id,
    fullName: 'Ops',
    email: 'ops@barcode.test',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });

  const linked = await MasterSku.create({ tenantId: tenant._id, code: 'LEHKCPC106', name: 'Dupatta 106', barcode: '8901234567890' });
  await MasterSku.create({ tenantId: tenant._id, code: 'LEHKCPC123', name: 'Dupatta 123', barcode: '8901234567123' });
  await MasterSku.create({ tenantId: other._id, code: 'LEHKCPC999', name: 'Other', barcode: 'OTHER-TENANT' });

  await Order.create({
    tenantId: tenant._id,
    orderNo: 'B-1',
    status: 'New',
    customer: 'Tejashree',
    items: [
      { name: 'Dupatta 106', sku: 'LEHKCPC106', qty: 1, price: 2799, masterSkuId: linked._id },
      { name: 'Dupatta 123', sku: 'lehkcpc123', qty: 1, price: 2799 },
      { name: 'Other', sku: 'LEHKCPC999', qty: 1, price: 100 },
    ],
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await memory.stop();
});

test('order detail shows each item barcode from its master SKU, in this company only', async () => {
  const token = await login('ops@barcode.test');
  const res = await fetch(`${base}/api/v1/orders/B-1`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const items = (await res.json()).data.items;
  const barcodeOf = (sku) => items.find((item) => item.sku === sku).barcode;
  assert.equal(barcodeOf('LEHKCPC106'), '8901234567890', 'linked master SKU');
  assert.equal(barcodeOf('lehkcpc123'), '8901234567123', 'matched by SKU code');
  assert.equal(barcodeOf('LEHKCPC999'), '', 'another company barcode never leaks');
});
