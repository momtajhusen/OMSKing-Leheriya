process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const Order = require('../src/models/Order');
const IntegrationJob = require('../src/models/IntegrationJob');
const InventoryReservation = require('../src/models/InventoryReservation');
const DemoRequest = require('../src/models/DemoRequest');
const { hashPassword } = require('../src/lib/password');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { login, exitImpersonation } = require('../src/controllers/auth.controller');
const tenants = require('../src/controllers/tenants.controller');
const users = require('../src/controllers/users.controller');
const { createDemoRequest } = require('../src/controllers/demoRequest.controller');
const { als } = require('../src/lib/tenantContext');
const { listPlatformJobs, processDueJobs } = require('../src/services/jobQueue.service');

let memory;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    cookie() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function callLogin(body) {
  return new Promise((resolve, reject) => {
    const req = { body, ip: '127.0.0.1', headers: {} };
    const res = fakeRes();
    login(req, res).then(() => resolve(res)).catch(reject);
  });
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('a suspended merchant cannot sign in', async () => {
  const email = `suspended-${Date.now()}@example.com`;
  const created = await provisionMerchant({
    name: 'Paused Shop',
    ownerEmail: email,
    ownerName: 'Paused Owner',
    password: 'Password1',
    status: 'active',
  });
  created.tenant.status = 'suspended';
  await created.tenant.save();
  await assert.rejects(
    () => callLogin({ email, password: 'Password1', workspace: created.tenant.slug }),
    /suspended/,
  );
});

test('leaving a merchant returns the platform session and does not mix that merchant orders into the subscriber list', async () => {
  const platform = await Tenant.create({
    name: 'OMSKing SaaS',
    slug: `plat-${Date.now()}`,
    kind: 'platform',
    status: 'active',
  });
  const role = await Role.create({
    tenantId: platform._id,
    code: 'platform_admin',
    name: 'Platform Admin',
    permissions: ['tenants.manage', 'users.manage', 'settings.manage'],
    isSystem: true,
  });
  const admin = await User.create({
    tenantId: platform._id,
    fullName: 'Platform Operator',
    email: `ops-${Date.now()}@omsking.com`,
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
  });
  const merchant = await provisionMerchant({
    name: 'Leheriya Isolated',
    ownerEmail: `leh-${Date.now()}@example.com`,
    ownerName: 'Leheriya Owner',
    password: 'Password1',
  });
  await Order.create({
    tenantId: merchant.tenant._id,
    orderNo: 'SHP-SECRET-1',
    channel: 'Shopify',
    source: 'manual',
    customer: 'Hidden Buyer',
    phone: '9000011122',
    status: 'New',
    items: [{ name: 'Kurta', sku: 'K1', qty: 1, price: 100 }],
  });
  const opened = fakeRes();
  await tenants.impersonate({
    user: { id: String(admin._id), role: 'platform_admin' },
    params: { id: String(merchant.tenant._id) },
    headers: {},
    ip: '127.0.0.1',
  }, opened);
  assert.equal(opened.body.data.user.impersonating, true);
  assert.equal(opened.body.data.user.tenantName, 'Leheriya Isolated');

  const left = fakeRes();
  await als.run({
    tenantId: String(merchant.tenant._id),
    skipTenantFilter: false,
    userId: String(admin._id),
  }, () => exitImpersonation({
    user: { id: String(admin._id), impersonating: true },
    headers: {},
    ip: '127.0.0.1',
  }, left));
  assert.equal(left.body.data.user.impersonating, false);
  assert.equal(left.body.data.user.tenantId, String(platform._id));
  assert.equal(left.body.data.user.tenantName, 'OMSKing SaaS');

  const listed = fakeRes();
  await tenants.listTenants({ user: { role: 'platform_admin' } }, listed);
  const packed = JSON.stringify(listed.body.data);
  assert.equal(packed.includes('Hidden Buyer'), false);
  assert.equal(packed.includes('9000011122'), false);
  assert.equal(packed.includes('SHP-SECRET-1'), false);
  assert.equal(listed.body.data.some((row) => row.name === 'Leheriya Isolated'), true);

  const merchantUser = await User.findOne({ tenantId: merchant.tenant._id }).setOptions({ skipTenantFilter: true });
  const staffRes = fakeRes();
  await users.listUsers({
    skipTenantFilter: true,
    user: { homeTenantId: String(platform._id) },
    query: {},
  }, staffRes);
  const emails = staffRes.body.data.map((row) => row.email);
  assert.equal(emails.includes(admin.email), true);
  assert.equal(emails.includes(merchantUser.email), false);
});

test('a demo request does not open a merchant account', async () => {
  const email = `walkthrough-${Date.now()}@example.com`;
  const beforeUsers = await User.countDocuments({ email }).setOptions({ skipTenantFilter: true });
  const beforeTenants = await Tenant.countDocuments({ name: 'Walkthrough Cloth' });
  const res = fakeRes();
  await createDemoRequest({
    body: {
      name: 'Walk Buyer',
      email,
      phone: '9876543210',
      company: 'Walkthrough Cloth',
      city: 'Jaipur',
      monthlyOrders: '500-2000',
      channels: ['Shopify'],
      message: 'Show the desk',
    },
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(await DemoRequest.countDocuments({ email }), 1);
  assert.equal(await User.countDocuments({ email }).setOptions({ skipTenantFilter: true }), beforeUsers);
  assert.equal(await Tenant.countDocuments({ name: 'Walkthrough Cloth' }), beforeTenants);
});

test('retry reuses the failed job and does not reserve again, and secrets stay off the row', async () => {
  const tenant = await Tenant.create({ name: 'Job Shop', slug: `job-${Date.now()}`, kind: 'merchant', status: 'active' });
  const skuId = new mongoose.Types.ObjectId();
  const warehouseId = new mongoose.Types.ObjectId();
  await InventoryReservation.create({
    tenantId: tenant._id,
    masterSkuId: skuId,
    warehouseId,
    orderRef: 'SHP-1',
    channel: 'shopify',
    qty: 1,
    status: 'held',
    idempotencyKey: `hold-${Date.now()}`,
  });
  const job = await IntegrationJob.create({
    tenantId: tenant._id,
    channel: 'shopify',
    jobType: 'orders_pull',
    direction: 'pull',
    status: 'failed',
    effectApplied: true,
    effectCount: 1,
    lastError: 'token=shpat_live_token webhookSecret=whsec_super',
    payload: { apiToken: 'shpat_live_token', webhookSecret: 'whsec_super' },
    finishedAt: new Date(),
  });
  const rows = await listPlatformJobs();
  const packed = JSON.stringify(rows);
  assert.equal(packed.includes('shpat_live_token'), false);
  assert.equal(packed.includes('whsec_super'), false);
  assert.match(rows.find((row) => row.id === String(job._id)).lastError, /redacted/);

  const res = fakeRes();
  await tenants.retryOpsJob({ params: { id: String(job._id) }, user: { id: null } }, res);
  assert.equal(res.body.data.id, String(job._id));
  assert.equal(res.body.data.status, 'queued');
  assert.equal(await IntegrationJob.countDocuments({ tenantId: tenant._id }), 1);

  await processDueJobs();
  const fresh = await IntegrationJob.findById(job._id).setOptions({ skipTenantFilter: true });
  assert.equal(fresh.status, 'success');
  assert.equal(fresh.effectCount, 1);
  assert.match(fresh.shortSummary, /did not reserve again/);
  assert.equal(await InventoryReservation.countDocuments({ tenantId: tenant._id, orderRef: 'SHP-1' }), 1);

  const listed = fakeRes();
  await tenants.listTenants({}, listed);
  const card = listed.body.data.find((row) => row.name === 'Job Shop');
  assert.ok(card.lastSync);
  assert.equal(JSON.stringify(card).includes('shpat_'), false);
});
