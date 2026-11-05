process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const Order = require('../src/models/Order');
const AuditLog = require('../src/models/AuditLog');

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
  const ownerEmail = `notes-${label}-${Date.now()}@example.com`;
  const created = await provisionMerchant({ name: `Notes ${label}`, ownerEmail, ownerName: 'Owner', password: PASSWORD, status: 'active' });
  const res = await api('POST', '/api/v1/auth/login', { json: { email: ownerEmail, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { tenantId: created.tenant._id, token: res.body.data.accessToken };
}

function order(tenantId, orderNo, extra = {}) {
  return Order.create({
    tenantId,
    orderNo,
    channel: 'Shopify',
    status: 'New',
    customer: 'Neha Arora',
    address: 'E block 1303',
    city: 'Jalandhar 144022',
    total: 1799,
    items: [{ name: 'Banarasi Suit', sku: 'LEHBAN58304', qty: 1, price: 1999 }],
    ...extra,
  });
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

test('PATCH /orders/:id/notes saves the order notes, returns them on the order and audits the change', async () => {
  const { tenantId, token } = await merchant('save');
  await order(tenantId, 'SHP-N-1');
  const res = await api('PATCH', '/api/v1/orders/SHP-N-1/notes', { token, json: { notes: '  Dispatch after 10 Nov. Customer not available.  ' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.notes, 'Dispatch after 10 Nov. Customer not available.');
  const saved = await Order.findOne({ tenantId, orderNo: 'SHP-N-1' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(saved.notes, 'Dispatch after 10 Nov. Customer not available.');
  const audit = await AuditLog.findOne({ tenantId, action: 'order.notes_updated' }).setOptions({ skipTenantFilter: true }).lean();
  assert.ok(audit, 'notes change is audited');
  assert.equal(audit.before.notes, '');
  assert.equal(audit.after.notes, 'Dispatch after 10 Nov. Customer not available.');

  const got = await api('GET', '/api/v1/orders/SHP-N-1', { token });
  assert.equal(got.body.data.notes, 'Dispatch after 10 Nov. Customer not available.');

  const cleared = await api('PATCH', '/api/v1/orders/SHP-N-1/notes', { token, json: { notes: '' } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.data.notes, '');
});

test('order notes can be added on a labelled or dispatched order and on a marketplace order', async () => {
  const { tenantId, token } = await merchant('locked');
  await order(tenantId, 'SHP-N-2', { awb: 'AWB1', status: 'Dispatched' });
  await order(tenantId, 'AMZ-N-3', { channel: 'Amazon' });
  const shipped = await api('PATCH', '/api/v1/orders/SHP-N-2/notes', { token, json: { notes: 'Call before delivery' } });
  assert.equal(shipped.status, 200, JSON.stringify(shipped.body));
  const amazon = await api('PATCH', '/api/v1/orders/AMZ-N-3/notes', { token, json: { notes: 'Gift wrap' } });
  assert.equal(amazon.status, 200, JSON.stringify(amazon.body));
});

test('PATCH /orders/:id/notes rejects a too-long note, needs a login and never reaches another tenant', async () => {
  const { tenantId, token } = await merchant('guard');
  await order(tenantId, 'SHP-N-4');
  const long = await api('PATCH', '/api/v1/orders/SHP-N-4/notes', { token, json: { notes: 'x'.repeat(1001) } });
  assert.equal(long.status, 400);
  const anon = await api('PATCH', '/api/v1/orders/SHP-N-4/notes', { json: { notes: 'hi' } });
  assert.equal(anon.status, 401);

  const other = await merchant('other');
  await order(other.tenantId, 'SHP-N-OTHER');
  const cross = await api('PATCH', '/api/v1/orders/SHP-N-OTHER/notes', { token, json: { notes: 'hack' } });
  assert.equal(cross.status, 404);
  const untouched = await Order.findOne({ tenantId: other.tenantId, orderNo: 'SHP-N-OTHER' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(untouched.notes || '', '');
});
