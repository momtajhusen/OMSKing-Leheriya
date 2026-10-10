process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { hashPassword } = require('../src/lib/password');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { processDueJobs } = require('../src/services/jobQueue.service');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const Order = require('../src/models/Order');
const DemoRequest = require('../src/models/DemoRequest');
const IntegrationJob = require('../src/models/IntegrationJob');
const InventoryReservation = require('../src/models/InventoryReservation');
const app = require('../src/app');

const LEH_PACK = 'LEH-PACK-14';
const SUR_PACK = 'SUR-PACK-14';
const TOKEN = 'shpat_platformtesttoken';
const HOOK = 'whsec_platformhooksecret';

let memory;
let server;
let base;
let platformToken;
let platformTenantId;
let leheriya;
let surat;

function cookieHeader(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const raw = list.length ? list : [res.headers.get('set-cookie')].filter(Boolean);
  return raw.map((row) => String(row).split(';')[0]).join('; ');
}

async function api(method, path, { token, json, cookie } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  return { status: res.status, body, cookie: cookieHeader(res) };
}

async function login(email, password = 'Password1') {
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password } });
  return { ...res, token: res.body?.data?.accessToken || '' };
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const platform = await Tenant.create({
    name: 'OMSKing SaaS',
    slug: `platform-${Date.now()}`,
    kind: 'platform',
    status: 'active',
  });
  platformTenantId = String(platform._id);
  const role = await Role.create({
    tenantId: platform._id,
    code: 'platform_admin',
    name: 'Platform Admin',
    permissions: ['tenants.manage', 'users.manage', 'settings.manage'],
    isSystem: true,
  });
  await User.create({
    tenantId: platform._id,
    fullName: 'Platform Operator',
    email: 'platform-audit@omsking.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });

  leheriya = await provisionMerchant({
    name: 'Leheriya Silks',
    ownerEmail: 'leheriya-staff@example.com',
    ownerName: 'Leheriya Staff',
    password: 'Password1',
    status: 'active',
  });
  surat = await provisionMerchant({
    name: 'Surat Silks',
    ownerEmail: 'surat-staff@example.com',
    ownerName: 'Surat Silks Staff',
    password: 'Password1',
    status: 'active',
  });
  await Order.create({
    tenantId: leheriya.tenant._id,
    orderNo: LEH_PACK,
    channel: 'Shopify',
    source: 'manual',
    customer: 'Hidden Leheriya Buyer',
    phone: '9811100141',
    status: 'Packed',
    total: 499,
    items: [{ name: 'Bandhani', sku: 'LEH-SKU', qty: 1, price: 499, gst: 5 }],
  });
  await Order.create({
    tenantId: surat.tenant._id,
    orderNo: SUR_PACK,
    channel: 'Shopify',
    source: 'manual',
    customer: 'Hidden Surat Buyer',
    phone: '9811100142',
    status: 'Packed',
    total: 799,
    items: [{ name: 'Patola', sku: 'SUR-SKU', qty: 1, price: 799, gst: 5 }],
  });

  const signed = await login('platform-audit@omsking.com');
  assert.equal(signed.status, 200);
  platformToken = signed.token;
});

test.after(async () => {
  server.close();
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('a demo request stores the company and creates no account', async () => {
  const usersBefore = await User.countDocuments();
  const tenantsBefore = await Tenant.countDocuments();
  const res = await api('POST', '/api/v1/demo-requests', {
    json: {
      name: 'Meera Shah',
      email: 'meera@newmill.com',
      phone: '9876543210',
      company: 'New Mill Prints',
      city: 'Surat',
      monthlyOrders: '500-2000',
      channels: ['Shopify', 'Myntra'],
      message: 'Need packing for two stores',
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.accessToken, undefined);
  const saved = await DemoRequest.findOne({ email: 'meera@newmill.com' });
  assert.equal(saved.company, 'New Mill Prints');
  assert.equal(saved.city, 'Surat');
  assert.equal(saved.monthlyOrders, '500-2000');
  assert.deepEqual(saved.channels, ['Shopify', 'Myntra']);
  const listed = await api('GET', '/api/v1/demo-requests', { token: platformToken });
  assert.equal(listed.status, 200);
  const shown = JSON.stringify(listed.body);
  assert.match(shown, /New Mill Prints/);
  assert.match(shown, /meera@newmill.com/);
  assert.equal(shown.includes('accessToken'), false);
  assert.equal(await User.countDocuments({ email: 'meera@newmill.com' }), 0);
  assert.equal(await Tenant.countDocuments({ name: 'New Mill Prints' }), 0);
  assert.equal(await User.countDocuments(), usersBefore);
  assert.equal(await Tenant.countDocuments(), tenantsBefore);
});

test('trial lasts 14 days and sign-in stays blocked until the month is marked', async () => {
  const trial = await provisionMerchant({
    name: 'Trial Mill',
    ownerEmail: 'trial-mill@example.com',
    ownerName: 'Trial Owner',
    password: 'Password1',
    status: 'trial',
  });
  const days = (new Date(trial.tenant.planExpiresAt).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 13 && days < 15, `trial length was ${days} days`);

  trial.tenant.planExpiresAt = new Date(Date.now() - 60_000);
  await trial.tenant.save();

  const blocked = await login('trial-mill@example.com');
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.message, /This trial ended/);
  assert.match(blocked.body.message, /₹1,000/);
  assert.equal(blocked.body?.data?.accessToken, undefined);
  assert.equal(blocked.token, '');

  const still = await login('trial-mill@example.com');
  assert.equal(still.status, 403);
  assert.match(still.body.message, /₹1,000/);
  assert.equal(still.token, '');

  const marked = await api('POST', `/api/v1/pricing/subscriptions/${trial.tenant._id}/payments`, {
    token: platformToken,
    json: { amount: 1000, note: 'October marked by platform' },
  });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.data.monthStatus, 'paid');

  const open = await login('trial-mill@example.com');
  assert.equal(open.status, 200);
  assert.ok(open.token);
});

test('suspending a company blocks its sign-in', async () => {
  const before = await login(leheriya.owner.email);
  assert.equal(before.status, 200);
  const suspended = await api('PATCH', `/api/v1/tenants/${leheriya.tenant._id}`, {
    token: platformToken,
    json: { status: 'suspended' },
  });
  assert.equal(suspended.status, 200);
  const blocked = await login(leheriya.owner.email);
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.message, /suspended/i);
  assert.equal(blocked.token, '');
  const existing = await api('GET', '/api/v1/orders', { token: before.token });
  assert.equal(existing.status, 403);
  await api('PATCH', `/api/v1/tenants/${leheriya.tenant._id}`, {
    token: platformToken,
    json: { status: 'active' },
  });
});

test('open tenant shows one merchant and back leaves no merchant session', async () => {
  const opened = await api('POST', `/api/v1/tenants/${leheriya.tenant._id}/impersonate`, { token: platformToken });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.data.user.impersonating, true);
  assert.equal(opened.body.data.user.tenantId, String(leheriya.tenant._id));
  const merchantToken = opened.body.data.accessToken;

  const packing = await api('GET', '/api/v1/orders', { token: merchantToken });
  assert.equal(packing.status, 200);
  const text = JSON.stringify(packing.body);
  assert.match(text, new RegExp(LEH_PACK));
  assert.doesNotMatch(text, new RegExp(SUR_PACK));
  assert.doesNotMatch(text, /Hidden Surat Buyer/);

  const back = await api('POST', '/api/v1/auth/exit-impersonation', { token: merchantToken });
  assert.equal(back.status, 200);
  assert.equal(back.body.data.user.impersonating, false);
  assert.equal(back.body.data.user.tenantId, platformTenantId);
  assert.equal(back.body.data.user.tenantName, 'OMSKing SaaS');
  platformToken = back.body.data.accessToken;

  const stale = await api('GET', '/api/v1/orders', { token: merchantToken });
  assert.equal(stale.status, 401);
  assert.doesNotMatch(JSON.stringify(stale.body), new RegExp(LEH_PACK));

  const platformOrders = await api('GET', '/api/v1/orders', { token: back.body.data.accessToken });
  assert.ok(platformOrders.status === 400 || platformOrders.status === 403);
  const leftover = JSON.stringify(platformOrders.body);
  assert.doesNotMatch(leftover, new RegExp(LEH_PACK));
  assert.doesNotMatch(leftover, new RegExp(SUR_PACK));
  assert.doesNotMatch(leftover, /Hidden Leheriya Buyer/);
});

test('platform users never include Leheriya or Surat Silks staff', async () => {
  const listed = await api('GET', `/api/v1/users?tenantId=${leheriya.tenant._id}`, { token: platformToken });
  assert.equal(listed.status, 200);
  const text = JSON.stringify(listed.body);
  assert.match(text, /platform-audit@omsking.com/);
  assert.doesNotMatch(text, /leheriya-staff@example.com/);
  assert.doesNotMatch(text, /surat-staff@example.com/);
  assert.doesNotMatch(text, /Leheriya Staff/);
  assert.doesNotMatch(text, /Surat Silks Staff/);
});

test('retry does not reserve stock and job rows hide tokens', async () => {
  const job = await IntegrationJob.create({
    tenantId: leheriya.tenant._id,
    channel: 'shopify',
    jobType: 'orders_pull',
    direction: 'pull',
    status: 'failed',
    effectApplied: true,
    effectCount: 1,
    lastError: `Shopify rejected ${TOKEN} and ${HOOK}`,
    shortSummary: `webhook ${HOOK}`,
    payload: { adminToken: TOKEN, webhookSecret: HOOK },
    nextRunAt: new Date(),
  });
  const before = await InventoryReservation.countDocuments();

  const jobs = await api('GET', '/api/v1/tenants/ops/jobs', { token: platformToken });
  const logs = await api('GET', '/api/v1/tenants/ops/logs', { token: platformToken });
  const health = await api('GET', '/api/v1/tenants', { token: platformToken });
  for (const res of [jobs, logs, health]) {
    assert.equal(res.status, 200);
    const text = JSON.stringify(res.body);
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes(HOOK), false);
  }

  const retried = await api('POST', `/api/v1/tenants/ops/jobs/${job._id}/retry`, { token: platformToken });
  assert.equal(retried.status, 200);
  assert.equal(JSON.stringify(retried.body).includes(TOKEN), false);
  assert.equal(JSON.stringify(retried.body).includes(HOOK), false);

  await processDueJobs();
  const rows = await IntegrationJob.find({ tenantId: leheriya.tenant._id, jobType: 'orders_pull' });
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0]._id), String(job._id));
  assert.equal(rows[0].effectCount, 1);
  assert.match(rows[0].shortSummary, /did not reserve again/);
  assert.equal(await InventoryReservation.countDocuments(), before);

  const after = await api('GET', '/api/v1/tenants/ops/logs', { token: platformToken });
  const shown = JSON.stringify(after.body);
  assert.equal(shown.includes(TOKEN), false);
  assert.equal(shown.includes(HOOK), false);
});
