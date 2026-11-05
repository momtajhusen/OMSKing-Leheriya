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
const KEYS = ['orders.edit_details', 'orders.payment_mode'];

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

test('new company: only the owner role starts with Order editing and Change mode of payment', async () => {
  const { roles } = await merchant('Edit Defaults');
  const perms = Object.fromEntries(roles.map((row) => [row.code, row.permissions]));
  for (const key of KEYS) {
    assert.equal(perms.super_admin.includes(key), true, key);
    for (const code of ['operations', 'warehouse', 'accounts', 'catalog_manager', 'customer_support', 'vendor']) {
      assert.equal(perms[code].includes(key), false, `${code} ${key}`);
    }
  }
});

test('owner can give both options to a staff role and take them back', async () => {
  const shop = await merchant('Edit Toggle');
  const owner = await login(shop.owner.email);
  assert.equal((await login(shop.opsEmail)).user.permissions.includes('orders.payment_mode'), false);

  const granted = await api('PATCH', `/api/v1/roles/${shop.opsRole._id}`, {
    token: owner.accessToken,
    json: { permissions: [...shop.opsRole.permissions, ...KEYS] },
  });
  assert.equal(granted.status, 200, JSON.stringify(granted.body));
  const ops = await login(shop.opsEmail);
  for (const key of KEYS) assert.equal(ops.user.permissions.includes(key), true, key);

  const removed = await api('PATCH', `/api/v1/roles/${shop.opsRole._id}`, {
    token: owner.accessToken,
    json: { permissions: shop.opsRole.permissions },
  });
  assert.equal(removed.status, 200);
  const again = await login(shop.opsEmail);
  for (const key of KEYS) assert.equal(again.user.permissions.includes(key), false, key);
});

test('owner roles saved before the options existed get them once; staff roles do not', async () => {
  const shop = await merchant('Edit Backfill');
  const superRole = shop.roles.find((row) => row.code === 'super_admin');
  for (const role of [superRole, shop.opsRole]) {
    await Role.collection.updateOne(
      { _id: role._id },
      { $pull: { permissions: { $in: KEYS }, permissionRollouts: { $in: KEYS } } },
    );
  }

  await applyPermissionRollouts();
  for (const key of KEYS) {
    assert.equal((await roleOf(superRole._id)).permissions.includes(key), true, key);
    assert.equal((await roleOf(shop.opsRole._id)).permissions.includes(key), false, key);
  }
});
