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
const Warehouse = require('../src/models/Warehouse');
const Inventory = require('../src/models/Inventory');
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

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenant = await Tenant.create({ name: 'Stock Columns', slug: `stock-columns-${Date.now()}`, kind: 'merchant', status: 'active' });
  const other = await Tenant.create({ name: 'Other Stock', slug: `other-stock-${Date.now()}`, kind: 'merchant', status: 'active' });
  const role = await Role.create({ tenantId: tenant._id, code: 'catalog_viewer', name: 'Catalog viewer', permissions: ['catalog.view'] });
  await User.create({
    tenantId: tenant._id,
    fullName: 'Catalog Viewer',
    email: 'stockcols@example.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });

  const offline = await Warehouse.create({ tenantId: tenant._id, code: 'WH-001', name: 'Physical / Offline', type: 'physical' });
  const virtual = await Warehouse.create({ tenantId: tenant._id, code: 'WH-002', name: 'Virtual / Shopify only', type: 'virtual' });
  const otherWh = await Warehouse.create({ tenantId: other._id, code: 'WH-001', name: 'Other Offline', type: 'physical' });

  const product = await Product.create({ tenantId: tenant._id, name: 'Mangalgiri Suit', hsnCode: '5407' });
  const red = await MasterSku.create({ tenantId: tenant._id, productId: product._id, code: 'LEH-RED', name: 'Mangalgiri Suit Red' });
  await MasterSku.create({ tenantId: tenant._id, productId: product._id, code: 'LEH-BLUE', name: 'Mangalgiri Suit Blue' });

  await Inventory.create({ tenantId: tenant._id, masterSkuId: red._id, warehouseId: offline._id, physicalQty: 9, reservedQty: 2 });
  await Inventory.create({ tenantId: tenant._id, masterSkuId: red._id, warehouseId: virtual._id, virtualQty: 20 });
  await Inventory.create({ tenantId: other._id, masterSkuId: red._id, warehouseId: otherWh._id, physicalQty: 500 });
});

test.after(async () => {
  server.close();
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('products list gives each variant In Stock for Offline (Shopify Offline/Amazon/Myntra) and Virtual, tenant-scoped', async () => {
  const token = await login('stockcols@example.com');
  for (const path of ['/api/v1/products', '/api/v1/products?page=1&limit=25']) {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json();
    assert.equal(res.status, 200);
    const byCode = Object.fromEntries(body.data[0].variants.map((v) => [v.code, v.stock]));
    assert.deepEqual(byCode['LEH-RED'], { offline: 9, virtual: 20 });
    assert.deepEqual(byCode['LEH-BLUE'], { offline: 0, virtual: 0 });
  }
});
