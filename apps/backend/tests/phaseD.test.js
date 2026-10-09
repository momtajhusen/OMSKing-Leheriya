process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const Order = require('../src/models/Order');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const AuditLog = require('../src/models/AuditLog');
const IntegrationJob = require('../src/models/IntegrationJob');
const { als } = require('../src/lib/tenantContext');
const { hashPassword } = require('../src/lib/password');
const { encryptObject } = require('../src/lib/secretBox');
const shopify = require('../src/adapters/shopify');
const { ingestChannelOrders } = require('../src/services/channelOrder.service');
const { listOrders } = require('../src/controllers/orders.controller');
const { patchCompany } = require('../src/controllers/settings.controller');
const { forgotPassword } = require('../src/controllers/auth.controller');
const { requeueJob, processDueJobs } = require('../src/services/jobQueue.service');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function shopifyOrder(id, { cancelled = false, total = '100' } = {}) {
  return shopify.mapShopifyOrder({
    id,
    cancelled_at: cancelled ? '2026-01-01T00:00:00Z' : null,
    fulfillment_status: null,
    financial_status: cancelled ? 'voided' : 'paid',
    line_items: [{ sku: 'SKU-D', title: 'Dupatta', quantity: 1, price: total }],
    total_price: total,
  }, {});
}

async function merchant(name) {
  return Tenant.create({
    name,
    slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: 'merchant',
    legalEntity: { gstin: '08OLDGSTIN0001Z', email: 'ops@example.com' },
  });
}

async function ordersFor(tenant, query) {
  const res = fakeRes();
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false }, () => listOrders({
    tenantId: tenant._id,
    skipTenantFilter: false,
    query,
  }, res));
  return res.body.data || [];
}

test('All Orders includes cancelled, and an unfulfilled order returns to New', async () => {
  const shop = await merchant('Phase D Shop');
  const other = await merchant('Other Shop');
  const sku = await MasterSku.create({ tenantId: shop._id, code: 'SKU-D', name: 'Dupatta' });
  await SkuMapping.create({
    tenantId: shop._id,
    masterSkuId: sku._id,
    channel: 'shopify',
    channelVariantId: 'var-d',
    channelSkuCode: 'SKU-D',
    channelSkuCodeNorm: 'sku-d',
    syncStatus: 'synced',
  });
  await ingestChannelOrders(shop._id, 'shopify', [
    shopifyOrder('9001', { cancelled: true, total: '500' }),
    shopifyOrder('9002', { total: '100' }),
  ]);
  await Order.create({
    tenantId: other._id,
    orderNo: 'OTHER-1',
    channel: 'Shopify',
    status: 'New',
    total: 999,
    source: 'manual',
  });

  const all = await ordersFor(shop, { status: 'all' });
  const ids = all.map((row) => row.id);
  assert.equal(ids.includes('SHP-9001'), true);
  assert.equal(ids.includes('SHP-9002'), true);
  assert.equal(ids.includes('OTHER-1'), false);
  const net = all.filter((row) => row.status !== 'Cancelled').reduce((sum, row) => sum + Number(row.total || 0), 0);
  assert.equal(net, 100);

  const fresh = await ordersFor(shop, { status: 'New' });
  assert.equal(fresh.some((row) => row.id === 'SHP-9001'), false);
  const cancelled = await ordersFor(shop, { status: 'Cancelled' });
  assert.equal(cancelled.some((row) => row.id === 'SHP-9001'), true);

  const again = shopifyOrder('9001', { cancelled: false, total: '500' });
  assert.equal(again.status, 'New');
  await ingestChannelOrders(shop._id, 'shopify', [again]);
  const reopened = await Order.findOne({ tenantId: shop._id, orderNo: 'SHP-9001' }).setOptions({ skipTenantFilter: true });
  assert.equal(reopened.status, 'New');
  const newTab = await ordersFor(shop, { status: 'New' });
  assert.equal(newTab.some((row) => row.id === 'SHP-9001'), true);
  const otherRows = await ordersFor(other, { status: 'all' });
  assert.deepEqual(otherRows.map((row) => row.id), ['OTHER-1']);
});

test('company GSTIN is audited without storing the mailbox password', async () => {
  const shop = await merchant('GST Shop');
  const res = fakeRes();
  await als.run({ tenantId: String(shop._id), skipTenantFilter: false }, () => patchCompany({
    tenantId: shop._id,
    skipTenantFilter: false,
    user: { role: 'super_admin' },
    headers: {},
    body: {
      gstin: '08NEWGSTIN0001Z',
      gmailUser: 'shop@example.com',
      gmailAppPassword: 'secret-pass-word',
    },
  }, res));
  assert.equal(res.body.data.gstin, '08NEWGSTIN0001Z');
  assert.equal(JSON.stringify(res.body).includes('secret-pass-word'), false);
  const log = await AuditLog.findOne({ tenantId: shop._id, action: 'company.updated' }).setOptions({ skipTenantFilter: true });
  const gstin = log.changes.find((change) => change.field === 'gstin');
  assert.equal(gstin.before, '08OLDGSTIN0001Z');
  assert.equal(gstin.after, '08NEWGSTIN0001Z');
  assert.equal(JSON.stringify(log.toObject()).includes('secret-pass-word'), false);
});

test('password OTP uses that company mailbox only', async () => {
  const a = await merchant('Mail A');
  const b = await merchant('Mail B');
  a.settings = { mail: { gmailUser: 'shop-a@example.com', gmailAppPasswordEnc: encryptObject({ pass: 'app-pass-a' }) } };
  b.settings = { mail: { gmailUser: 'shop-b@example.com', gmailAppPasswordEnc: encryptObject({ pass: 'app-pass-b' }) } };
  a.markModified('settings');
  b.markModified('settings');
  await a.save();
  await b.save();
  const role = await Role.create({ tenantId: a._id, name: 'Owner', code: 'owner', permissions: [] });
  const email = `owner-${Date.now()}@example.com`;
  await User.create({
    tenantId: a._id,
    fullName: 'Owner A',
    email,
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
  });
  const sent = [];
  const original = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    sendMail: async (message) => {
      sent.push(message);
      return { messageId: 'otp-1' };
    },
  });
  try {
    const res = fakeRes();
    await forgotPassword({ body: { email }, headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(sent.length, 1);
    assert.match(sent[0].from, /shop-a@example.com/);
    assert.equal(sent[0].from.includes('shop-b@example.com'), false);
    assert.equal(sent[0].to, email);
  } finally {
    nodemailer.createTransport = original;
  }
});

test('retrying a failed job keeps the same job and does not reserve again', async () => {
  const shop = await merchant('Jobs Shop');
  const job = await IntegrationJob.create({
    tenantId: shop._id,
    channel: 'shopify',
    jobType: 'inventory_push',
    status: 'failed',
    effectApplied: true,
    effectCount: 1,
    lastError: 'token=shpat_SECRETVALUE',
    shortSummary: 'failed',
  });
  const queued = await requeueJob(shop._id, null, job._id);
  assert.equal(queued.id, String(job._id));
  assert.equal(queued.status, 'queued');
  const count = await IntegrationJob.countDocuments({ tenantId: shop._id }).setOptions({ skipTenantFilter: true });
  assert.equal(count, 1);
  await processDueJobs({ limit: 5 });
  const fresh = await IntegrationJob.findById(job._id).setOptions({ skipTenantFilter: true });
  assert.equal(fresh.status, 'success');
  assert.equal(fresh.effectCount, 1);
  assert.match(fresh.shortSummary, /did not reserve again/);
});
