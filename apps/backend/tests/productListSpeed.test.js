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
const Product = require('../src/models/Product');
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
  const body = await res.json();
  assert.equal(res.status, 200);
  return body.data.accessToken;
}

async function seedCatalog(tenantId, prefix, count) {
  const products = await Product.insertMany(
    Array.from({ length: count }, (_, i) => ({
      tenantId,
      name: `${prefix} Suit ${i}`,
      status: i % 4 === 0 ? 'draft' : 'active',
    })),
  );
  await MasterSku.insertMany(
    products.flatMap((product, i) => [
      { tenantId, productId: product._id, code: `${prefix}-${i}-S`, name: `${prefix} ${i} S` },
      { tenantId, productId: product._id, code: `${prefix}-${i}-M`, name: `${prefix} ${i} M` },
    ]),
  );
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenant = await Tenant.create({ name: 'Big Catalog', slug: `big-catalog-${Date.now()}`, kind: 'merchant', status: 'active' });
  const other = await Tenant.create({ name: 'Other Catalog', slug: `other-catalog-${Date.now()}`, kind: 'merchant', status: 'active' });
  const role = await Role.create({ tenantId: tenant._id, code: 'catalog_viewer', name: 'Catalog viewer', permissions: ['catalog.view'] });
  await User.create({
    tenantId: tenant._id,
    fullName: 'Catalog Viewer',
    email: 'speed@example.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });
  await seedCatalog(tenant._id, 'LEHE', 60);
  await seedCatalog(other._id, 'OTHR', 10);
});

test.after(async () => {
  mongoose.set('debug', false);
  server.close();
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('opening the Products page does not load every product id of the catalogue', async () => {
  const token = await login('speed@example.com');
  const unlimited = [];
  mongoose.set('debug', (collection, method, ...args) => {
    if (collection !== 'products' || method !== 'find') return;
    if (!args.some((arg) => arg && typeof arg === 'object' && arg.limit)) unlimited.push(args[0]);
  });
  const res = await fetch(`${base}/api/v1/products?page=1&limit=25`, { headers: { authorization: `Bearer ${token}` } });
  mongoose.set('debug', false);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 25);
  assert.equal(body.meta.total, 60);
  assert.equal(body.meta.active, 45);
  assert.equal(body.meta.variants, 120);
  assert.deepEqual(unlimited, []);
});

test('searching products still counts only the matching products and their variants', async () => {
  const token = await login('speed@example.com');
  const res = await fetch(`${base}/api/v1/products?page=1&limit=25&q=${encodeURIComponent('Suit 1')}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.meta.total, 11);
  assert.equal(body.meta.variants, 22);
});
