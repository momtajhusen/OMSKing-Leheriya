process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { applyPermissionRollouts } = require('../src/services/permissionRollout.service');
const { hashPassword } = require('../src/lib/password');
const Role = require('../src/models/Role');
const User = require('../src/models/User');

const PASSWORD = 'Password1';

let memory;
let server;
let base;

async function api(method, path, { token, json } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(email) {
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

async function merchant(name) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const created = await provisionMerchant({
    name: `${name} ${stamp}`,
    ownerEmail: `owner-${stamp}@example.com`,
    ownerName: 'Owner',
    password: PASSWORD,
    status: 'active',
  });
  const opsRole = created.roles.find((row) => row.code === 'operations');
  const opsEmail = `ops-${stamp}@example.com`;
  await User.create({
    tenantId: created.tenant._id,
    fullName: 'Ops',
    email: opsEmail,
    passwordHash: await hashPassword(PASSWORD),
    roleId: opsRole._id,
    status: 'active',
    emailVerified: true,
  });
  return { ...created, opsRole, opsEmail };
}

const roleOf = (id) => Role.findById(id).setOptions({ skipTenantFilter: true });

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('new company roles get dashboard.view for staff, not for vendor', async () => {
  const { roles } = await merchant('Dash Defaults');
  const perms = Object.fromEntries(roles.map((row) => [row.code, row.permissions]));
  for (const code of ['super_admin', 'operations', 'warehouse', 'accounts', 'catalog_manager', 'customer_support']) {
    assert.equal(perms[code].includes('dashboard.view'), true, code);
  }
  assert.equal(perms.vendor.includes('dashboard.view'), false);
});

test('owner can take Dashboard Access away from a staff role; orders stay open', async () => {
  const shop = await merchant('Dash Toggle');
  const owner = await login(shop.owner.email);
  const before = await login(shop.opsEmail);
  assert.equal(before.user.permissions.includes('dashboard.view'), true);
  assert.equal((await api('GET', '/api/v1/orders/summary', { token: before.accessToken })).status, 200);

  const without = shop.opsRole.permissions.filter((key) => key !== 'dashboard.view');
  const saved = await api('PATCH', `/api/v1/roles/${shop.opsRole._id}`, { token: owner.accessToken, json: { permissions: without } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.permissions.includes('dashboard.view'), false);

  const ops = await login(shop.opsEmail);
  assert.equal(ops.user.permissions.includes('dashboard.view'), false);
  const summary = await api('GET', '/api/v1/orders/summary', { token: ops.accessToken });
  assert.equal(summary.status, 403);
  assert.match(summary.body.message, /dashboard\.view/);
  assert.equal((await api('GET', '/api/v1/orders', { token: ops.accessToken })).status, 200);
  assert.equal((await api('GET', '/api/v1/orders/summary', { token: owner.accessToken })).status, 200);

  const back = await api('PATCH', `/api/v1/roles/${shop.opsRole._id}`, { token: owner.accessToken, json: { permissions: [...without, 'dashboard.view'] } });
  assert.equal(back.status, 200);
  const again = await login(shop.opsEmail);
  assert.equal((await api('GET', '/api/v1/orders/summary', { token: again.accessToken })).status, 200);
});

test('roles saved before the option existed get dashboard.view once, and a later removal sticks', async () => {
  const shop = await merchant('Dash Backfill');
  const other = await merchant('Dash Other');
  const superRole = shop.roles.find((row) => row.code === 'super_admin');
  const vendorRole = shop.roles.find((row) => row.code === 'vendor');
  for (const role of [superRole, shop.opsRole, vendorRole]) {
    await Role.collection.updateOne(
      { _id: role._id },
      { $pull: { permissions: 'dashboard.view' }, $unset: { permissionRollouts: '' } },
    );
  }

  await applyPermissionRollouts();
  assert.equal((await roleOf(superRole._id)).permissions.includes('dashboard.view'), true);
  assert.equal((await roleOf(shop.opsRole._id)).permissions.includes('dashboard.view'), true);
  assert.equal((await roleOf(vendorRole._id)).permissions.includes('dashboard.view'), false);
  assert.equal((await roleOf(shop.opsRole._id)).permissions.includes('orders.view'), true);

  const owner = await login(shop.owner.email);
  const without = (await roleOf(shop.opsRole._id)).permissions.filter((key) => key !== 'dashboard.view');
  const saved = await api('PATCH', `/api/v1/roles/${shop.opsRole._id}`, { token: owner.accessToken, json: { permissions: without } });
  assert.equal(saved.status, 200);

  await applyPermissionRollouts();
  assert.equal((await roleOf(shop.opsRole._id)).permissions.includes('dashboard.view'), false);
  const otherOps = await roleOf(other.opsRole._id);
  assert.equal(otherOps.permissions.includes('dashboard.view'), true);
});
