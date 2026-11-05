process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');

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

async function merchant(label) {
  const created = await provisionMerchant({
    name: label,
    ownerEmail: `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@example.com`,
    ownerName: 'Owner',
    password: PASSWORD,
    status: 'active',
  });
  const res = await api('POST', '/api/v1/auth/login', { json: { email: created.owner.email, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken;
}

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

test('many Shopify vendor names map to one OMSKing vendor, and one name maps to only one vendor per company', async () => {
  const token = await merchant('Map One');
  const made = await api('POST', '/api/v1/vendors', {
    token,
    json: { name: 'Jaipur Prints', phone: '9111111111', shopifyVendors: ['Leheriya Jaipur', ' leheriya  jaipur ', 'JP Studio', ''] },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual(made.body.data.shopifyVendors, ['Leheriya Jaipur', 'JP Studio']);

  const other = await api('POST', '/api/v1/vendors', { token, json: { name: 'Surat Weaves', phone: '9222222222' } });
  assert.equal(other.status, 201, JSON.stringify(other.body));
  assert.deepEqual(other.body.data.shopifyVendors, []);
  const clash = await api('PATCH', `/api/v1/vendors/${other.body.data.id}`, { token, json: { shopifyVendors: ['jp studio'] } });
  assert.equal(clash.status, 409, JSON.stringify(clash.body));
  assert.match(clash.body.message, /Jaipur Prints/);

  const moved = await api('PATCH', `/api/v1/vendors/${made.body.data.id}`, { token, json: { shopifyVendors: ['Leheriya Jaipur'] } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(moved.body.data.shopifyVendors, ['Leheriya Jaipur']);
  const freed = await api('PATCH', `/api/v1/vendors/${other.body.data.id}`, { token, json: { shopifyVendors: ['JP Studio'] } });
  assert.equal(freed.status, 200, JSON.stringify(freed.body));

  const list = await api('GET', '/api/v1/vendors', { token });
  const byName = Object.fromEntries(list.body.data.map((row) => [row.name, row.shopifyVendors]));
  assert.deepEqual(byName['Jaipur Prints'], ['Leheriya Jaipur']);
  assert.deepEqual(byName['Surat Weaves'], ['JP Studio']);

  const otherCompany = await merchant('Map Two');
  const same = await api('POST', '/api/v1/vendors', {
    token: otherCompany,
    json: { name: 'Another Vendor', phone: '9333333333', shopifyVendors: ['Leheriya Jaipur'] },
  });
  assert.equal(same.status, 201, 'another company may map the same Shopify name');
});
