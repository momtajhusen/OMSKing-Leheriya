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
const SkuMapping = require('../src/models/SkuMapping');
const app = require('../src/app');

let memory;
let server;
let base;

async function api(method, path, token) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json() };
}

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

function listing(tenantId, masterSkuId, code, imageUrl, channel = 'shopify') {
  return SkuMapping.create({
    tenantId,
    masterSkuId,
    channel,
    channelVariantId: `gid-${code}`,
    channelSkuCode: code,
    channelSkuCodeNorm: code.toLowerCase(),
    imageUrl,
  });
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenant = await Tenant.create({ name: 'Variant Photos', slug: `variant-photos-${Date.now()}`, kind: 'merchant', status: 'active' });
  const other = await Tenant.create({ name: 'Other Shop', slug: `other-shop-${Date.now()}`, kind: 'merchant', status: 'active' });
  const role = await Role.create({ tenantId: tenant._id, code: 'catalog_viewer', name: 'Catalog viewer', permissions: ['catalog.view'] });
  await User.create({
    tenantId: tenant._id,
    fullName: 'Catalog Viewer',
    email: 'catalog@example.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });

  const product = await Product.create({
    tenantId: tenant._id,
    name: 'Bandhej Suit',
    hsnCode: '5208',
    images: ['https://cdn.shopify.com/s/files/suit-main.jpg'],
  });
  const red = await MasterSku.create({ tenantId: tenant._id, productId: product._id, code: 'LEHE-RED', name: 'Bandhej Suit Red', variantAttributes: { color: 'Red' } });
  const blue = await MasterSku.create({ tenantId: tenant._id, productId: product._id, code: 'LEHE-BLUE', name: 'Bandhej Suit Blue', variantAttributes: { color: 'Blue' } });
  await MasterSku.create({ tenantId: tenant._id, productId: product._id, code: 'LEHE-GREEN', name: 'Bandhej Suit Green', variantAttributes: { color: 'Green' } });

  await listing(tenant._id, red._id, 'LEHE-RED-AMZ', 'https://cdn.shopify.com/s/files/red-amazon.jpg', 'amazon');
  await listing(tenant._id, red._id, 'LEHE-RED', 'https://cdn.shopify.com/s/files/red.jpg');
  await listing(tenant._id, blue._id, 'LEHE-BLUE', 'https://cdn.shopify.com/s/files/blue.jpg');
  await listing(other._id, blue._id, 'OTHER-BLUE', 'https://cdn.shopify.com/s/files/other-tenant.jpg');
});

test.after(async () => {
  server.close();
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('products list gives each variant its own listing photo, Shopify first, scoped to the tenant', async () => {
  const token = await login('catalog@example.com');
  for (const path of ['/api/v1/products', '/api/v1/products?page=1&limit=25']) {
    const res = await api('GET', path, token);
    assert.equal(res.status, 200);
    const byCode = Object.fromEntries(res.body.data[0].variants.map((v) => [v.code, v.imageUrl]));
    assert.equal(byCode['LEHE-RED'], 'https://cdn.shopify.com/s/files/red.jpg');
    assert.equal(byCode['LEHE-BLUE'], 'https://cdn.shopify.com/s/files/blue.jpg');
    assert.equal(byCode['LEHE-GREEN'], '');
  }
});
