process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { hashPassword } = require('../src/lib/password');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { recordAudit } = require('../src/services/auditLog.service');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const Order = require('../src/models/Order');
const Product = require('../src/models/Product');
const MasterSku = require('../src/models/MasterSku');
const Vendor = require('../src/models/Vendor');
const Warehouse = require('../src/models/Warehouse');
const CourierAccount = require('../src/models/CourierAccount');
const SupportMessage = require('../src/models/SupportMessage');
const AuditLog = require('../src/models/AuditLog');
const SubscriptionPayment = require('../src/models/SubscriptionPayment');
const crypto = require('crypto');
const { savePricing } = require('../src/services/pricing.service');
const {
  periodKey, recordSubscriptionPayment, undoSubscriptionPayment, confirmRazorpayCheckout,
  applyRazorpayWebhook, submitUpiReference,
} = require('../src/services/subscription.service');

const PASSWORD = 'Password1';
const LEAK = 'zzleakb';
const PRIVATE = 'zzprivb';

const MERCHANT_GETS = [
  '/users', '/roles', '/sessions', '/auth/me', '/auth/password-resets',
  '/products', '/master-skus', '/sku-mappings', '/sku-mappings/unlisted', '/sku-mappings/summary',
  '/channels', '/channels/status', '/warehouses', '/warehouses/config', '/warehouses/links', '/warehouses/links/history',
  '/inventory', '/inventory/ats', '/inventory/ledger', '/inventory/alerts',
  '/orders', '/orders/summary', '/orders/manifests', '/orders/handover-manifests', '/orders/shipping-readiness',
  '/returns', '/ndr', '/reports', '/vendors', '/audit-logs', '/notifications',
  '/settings/company', '/settings/tax', '/settings/package-defaults', '/settings/couriers', '/settings/api-keys',
  '/integrations/jobs', '/integrations/webhooks', '/setup/checklist',
  '/tenants', '/tenants/setup-checklist', '/tenants/ops/settings',
  '/pricing/mine', '/pricing/mine/upi', '/pricing/subscriptions', '/pricing/inquiries', '/demo-requests',
  '/support/messages', '/support/unread', '/support/threads',
];

let memory;
let server;
let base;
let leheriya;
let surat;
let ownerToken;
let platformToken;

async function api(method, path, { token, json } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  return { status: res.status, text: await res.text() };
}

async function login(email) {
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(res.status, 200, res.text);
  return JSON.parse(res.text).data.accessToken;
}

async function seedSuratPrivateData() {
  const tenantId = surat.tenant._id;
  const ownerId = surat.owner._id;
  const staffRole = surat.roles.find((row) => row.code === 'operations');
  await User.create({
    tenantId, fullName: `${PRIVATE} staff`, email: 'zzprivb-staff@example.com',
    passwordHash: await hashPassword(PASSWORD), roleId: staffRole._id, status: 'active', emailVerified: true,
  });
  await Product.create({ tenantId, name: `${PRIVATE} product` });
  await MasterSku.create({ tenantId, code: `${PRIVATE}1`, name: `${PRIVATE} sku` });
  await Vendor.create({ tenantId, name: `${PRIVATE} vendor`, nameNorm: `${PRIVATE} vendor` });
  await Warehouse.create({ tenantId, code: 'ZZPB', name: `${PRIVATE} warehouse`, type: 'physical' });
  await CourierAccount.create({ tenantId, source: 'own', code: PRIVATE, name: `${PRIVATE} courier` });
  await Order.create({ tenantId, orderNo: `${PRIVATE}-order`, customer: `${PRIVATE} buyer`, orderDate: new Date() });
  await recordAudit({
    tenantId, actorId: ownerId, action: 'order.updated', resourceType: 'orders',
    resourceDisplay: `${PRIVATE} audit`, before: { note: '' }, after: { note: PRIVATE },
  });
  await SupportMessage.create({ tenantId, side: 'tenant', senderId: ownerId, text: `${LEAK} support question` });
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await AuditLog.syncIndexes();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const platform = await Tenant.create({ name: 'OMSKing SaaS', slug: 'platform-saas', kind: 'platform', status: 'active' });
  const role = await Role.create({
    tenantId: platform._id, code: 'platform_admin', name: 'Platform Admin',
    permissions: ['tenants.manage', 'users.manage', 'settings.manage'], isSystem: true,
  });
  await User.create({
    tenantId: platform._id, fullName: 'Platform Operator', email: 'platform-saas@omsking.com',
    passwordHash: await hashPassword(PASSWORD), roleId: role._id, status: 'active', emailVerified: true,
  });
  leheriya = await provisionMerchant({ name: 'Leheriya Saas', ownerEmail: 'owner-saas@example.com', ownerName: 'Owner', password: PASSWORD, status: 'active' });
  surat = await provisionMerchant({ name: `${LEAK} Surat`, ownerEmail: 'surat-saas@example.com', ownerName: 'Surat Owner', password: PASSWORD, status: 'active' });
  await seedSuratPrivateData();
  ownerToken = await login('owner-saas@example.com');
  platformToken = await login('platform-saas@omsking.com');
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('the seeded private data is visible to its own company (so the sweep below is meaningful)', async () => {
  const suratToken = await login('surat-saas@example.com');
  for (const path of ['/products', '/master-skus', '/vendors', '/warehouses', '/settings/couriers', '/orders', '/audit-logs', '/users', '/support/messages']) {
    const res = await api('GET', `/api/v1${path}`, { token: suratToken });
    assert.equal(res.status, 200, `${path} ${res.text.slice(0, 200)}`);
    const text = res.text.toLowerCase();
    assert.ok(text.includes(PRIVATE) || text.includes(LEAK), `${path} should show Surat's own marker`);
  }
});

test('no list API shows another company\'s data to a merchant admin', async () => {
  const leaks = [];
  for (const path of MERCHANT_GETS) {
    const res = await api('GET', `/api/v1${path}`, { token: ownerToken });
    assert.ok(res.status < 500, `${path} -> ${res.status} ${res.text.slice(0, 200)}`);
    const text = res.text.toLowerCase();
    if (text.includes(LEAK) || text.includes(PRIVATE)) leaks.push(`${path} (${res.status})`);
  }
  assert.deepEqual(leaks, []);
});

test('a merchant admin cannot read, change or delete another company\'s records by id', async () => {
  const tenantId = surat.tenant._id;
  const opts = { skipTenantFilter: true };
  const targets = {
    products: await Product.findOne({ tenantId }).setOptions(opts),
    'master-skus': await MasterSku.findOne({ tenantId }).setOptions(opts),
    vendors: await Vendor.findOne({ tenantId }).setOptions(opts),
    warehouses: await Warehouse.findOne({ tenantId }).setOptions(opts),
    'settings/couriers': await CourierAccount.findOne({ tenantId }).setOptions(opts),
    orders: await Order.findOne({ tenantId }).setOptions(opts),
    users: await User.findOne({ tenantId, email: 'zzprivb-staff@example.com' }).setOptions(opts),
  };
  const opened = [];
  for (const [path, doc] of Object.entries(targets)) {
    const url = `/api/v1/${path}/${doc._id}`;
    const read = await api('GET', url, { token: ownerToken });
    if (read.status === 200 && read.text.toLowerCase().includes(PRIVATE)) opened.push(`GET ${path}`);
    const patch = await api('PATCH', url, { token: ownerToken, json: { name: 'hijacked', fullName: 'hijacked', customer: 'hijacked' } });
    if (patch.status < 300) opened.push(`PATCH ${path} (${patch.status})`);
    const del = await api('DELETE', url, { token: ownerToken, json: { confirmLinkedData: true } });
    if (del.status < 300) opened.push(`DELETE ${path} (${del.status})`);
    const still = await doc.constructor.findById(doc._id).setOptions(opts);
    assert.ok(still, `${path} must still exist`);
    assert.equal(JSON.stringify(still).includes('hijacked'), false, `${path} must be unchanged`);
  }
  assert.deepEqual(opened, []);
});

test('the platform admin never sees a company\'s private business data on company screens', async () => {
  const leaks = [];
  for (const path of MERCHANT_GETS.filter((row) => !row.startsWith('/support'))) {
    const res = await api('GET', `/api/v1${path}`, { token: platformToken });
    assert.ok(res.status < 500, `${path} -> ${res.status} ${res.text.slice(0, 200)}`);
    if (res.text.toLowerCase().includes(PRIVATE)) leaks.push(`${path} (${res.status})`);
  }
  assert.deepEqual(leaks, []);
});

async function trialShop(label) {
  const stamp = `${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const created = await provisionMerchant({
    name: `Shop ${stamp}`, ownerEmail: `${stamp}@example.com`, ownerName: 'Owner',
    password: PASSWORD, status: 'trial', plan: 'starter',
  });
  return { ...created, email: `${stamp}@example.com` };
}

async function razorpayPricing() {
  await savePricing({
    minimumMonthly: 1000,
    slabs: [{ upTo: null, rate: 2 }],
    payment: {
      upiId: 'omsking@upi', accountName: 'OMSKing',
      razorpayKeyId: 'rzp_test_saas', razorpayKeySecret: 'saas_secret', razorpayWebhookSecret: 'saas_hook',
    },
  });
}

function razorpayMock({ orders = {}, payments = {} }) {
  return async (url) => {
    const id = decodeURIComponent(String(url).split('/').pop());
    const body = String(url).includes('/v1/orders/') ? orders[id] : payments[id];
    return { ok: Boolean(body), json: async () => body || { error: { description: 'not found' } } };
  };
}

function signedHook(entity) {
  const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity } } }));
  const signature = crypto.createHmac('sha256', 'saas_hook').update(rawBody).digest('hex');
  return { rawBody, headers: { 'x-razorpay-signature': signature } };
}

async function monthRow(tenantId) {
  return SubscriptionPayment.findOne({ tenantId, period: periodKey() }).setOptions({ skipTenantFilter: true });
}

test('a Razorpay webhook payment that is not for an OMSKing order, or pays less than the order, does not mark the month paid', async () => {
  await razorpayPricing();
  const { tenant } = await trialShop('hook-forged');
  const notes = { tenantId: String(tenant._id), period: periodKey(), purpose: 'subscription' };

  const noOrder = await applyRazorpayWebhook(
    signedHook({ id: 'pay_no_order', status: 'captured', amount: 100, notes }),
    { fetchImpl: razorpayMock({}) },
  );
  assert.equal(noOrder.ignored, true);
  assert.equal(await monthRow(tenant._id), null);

  const short = await applyRazorpayWebhook(
    signedHook({ id: 'pay_short', order_id: 'order_short', status: 'captured', amount: 100, notes }),
    { fetchImpl: razorpayMock({ orders: { order_short: { id: 'order_short', amount: 100000, notes } } }) },
  );
  assert.equal(short.ignored, true);
  assert.equal(await monthRow(tenant._id), null);
});

test('a Razorpay payment is matched through the OMSKing order notes, not the payment notes', async () => {
  await razorpayPricing();
  const { tenant } = await trialShop('hook-order');
  const orderNotes = { tenantId: String(tenant._id), period: periodKey(), purpose: 'subscription' };
  const fetchImpl = razorpayMock({ orders: { order_ok: { id: 'order_ok', amount: 100000, notes: orderNotes } } });
  const applied = await applyRazorpayWebhook(
    signedHook({ id: 'pay_ok', order_id: 'order_ok', status: 'captured', amount: 100000, notes: {} }),
    { fetchImpl },
  );
  assert.equal(applied.ignored, false);
  assert.equal(applied.tenantId, String(tenant._id));
  assert.equal((await monthRow(tenant._id)).status, 'paid');

  const { tenant: other } = await trialShop('confirm-order');
  const otherNotes = { tenantId: String(other._id), period: periodKey(), purpose: 'subscription' };
  const signature = crypto.createHmac('sha256', 'saas_secret').update('order_c|pay_c').digest('hex');
  const confirmFetch = razorpayMock({
    orders: { order_c: { id: 'order_c', amount: 100000, notes: otherNotes } },
    payments: { pay_c: { id: 'pay_c', order_id: 'order_c', status: 'captured', amount: 100000, notes: {} } },
  });
  const paid = await confirmRazorpayCheckout(other, { razorpay_order_id: 'order_c', razorpay_payment_id: 'pay_c', razorpay_signature: signature }, { fetchImpl: confirmFetch });
  assert.equal(paid.monthStatus, 'paid');

  const { tenant: third } = await trialShop('confirm-short');
  const thirdNotes = { tenantId: String(third._id), period: periodKey(), purpose: 'subscription' };
  const shortSig = crypto.createHmac('sha256', 'saas_secret').update('order_s|pay_s').digest('hex');
  await assert.rejects(
    () => confirmRazorpayCheckout(third, { razorpay_order_id: 'order_s', razorpay_payment_id: 'pay_s', razorpay_signature: shortSig }, {
      fetchImpl: razorpayMock({
        orders: { order_s: { id: 'order_s', amount: 100000, notes: thirdNotes } },
        payments: { pay_s: { id: 'pay_s', order_id: 'order_s', status: 'captured', amount: 100, notes: thirdNotes } },
      }),
    }),
    /amount/i,
  );
  assert.equal(await monthRow(third._id), null);
});

test('undoing the payment that ended a trial puts the company back on its trial', async () => {
  const { tenant } = await trialShop('undo-trial');
  const trialEnd = tenant.planExpiresAt;
  const paid = await recordSubscriptionPayment(tenant._id, { amount: 1000 });
  assert.equal(paid.status, 'active');
  const { view } = await undoSubscriptionPayment(tenant._id);
  assert.equal(view.status, 'trial');
  const after = await Tenant.findById(tenant._id);
  assert.equal(after.status, 'trial');
  assert.equal(new Date(after.planExpiresAt).getTime(), new Date(trialEnd).getTime());
});

test('one UPI reference cannot be claimed by two companies', async () => {
  await razorpayPricing();
  const { tenant: first } = await trialShop('upi-first');
  const { tenant: second } = await trialShop('upi-second');
  await submitUpiReference(first, 'UTR998877665544');
  await assert.rejects(() => submitUpiReference(second, 'UTR998877665544'), /already/i);
});

test('when a trial ends, a signed-in user cannot keep refreshing their session', async () => {
  const shop = await trialShop('refresh-expired');
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: shop.email, password: PASSWORD }),
  });
  assert.equal(res.status, 200);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^refresh_token=/);
  await Tenant.updateOne({ _id: shop.tenant._id }, { planExpiresAt: new Date(Date.now() - 60000) });
  const refreshed = await fetch(`${base}/api/v1/auth/refresh`, { method: 'POST', headers: { cookie } });
  assert.equal(refreshed.status, 403);
});

test('suspending, re-activating or changing a company plan is written to the audit log', async () => {
  const { tenant } = await trialShop('audit-suspend');
  const res = await api('PATCH', `/api/v1/tenants/${tenant._id}`, { token: platformToken, json: { status: 'suspended', plan: 'growth' } });
  assert.equal(res.status, 200, res.text);
  const row = await AuditLog.findOne({ action: 'tenant.updated', resourceId: tenant._id }).setOptions({ skipTenantFilter: true });
  assert.ok(row, 'tenant.updated audit row');
  assert.equal(row.before.status, 'trial');
  assert.equal(row.after.status, 'suspended');
});

test('roles: a company cannot grant itself SaaS powers or touch billing records', async () => {
  const roles = JSON.parse((await api('GET', '/api/v1/roles', { token: ownerToken })).text).data;
  const ops = roles.find((row) => row.code === 'operations');
  const grant = await api('PATCH', `/api/v1/roles/${ops.id}`, { token: ownerToken, json: { permissions: [...ops.permissions, 'tenants.manage'] } });
  assert.equal(grant.status, 400);
  const vendor = roles.find((row) => row.code === 'vendor');
  const vendorGrant = await api('PATCH', `/api/v1/roles/${vendor.id}`, { token: ownerToken, json: { permissions: [...vendor.permissions, 'users.manage'] } });
  assert.equal(vendorGrant.status, 400);

  const own = String(leheriya.tenant._id);
  assert.equal((await api('POST', `/api/v1/pricing/subscriptions/${own}/payments`, { token: ownerToken, json: { amount: 1 } })).status, 403);
  assert.equal((await api('DELETE', `/api/v1/pricing/subscriptions/${own}/payments`, { token: ownerToken })).status, 403);
  assert.equal((await api('PATCH', `/api/v1/tenants/${own}`, { token: ownerToken, json: { status: 'active' } })).status, 403);
  assert.equal((await api('PUT', '/api/v1/pricing', { token: ownerToken, json: { minimumMonthly: 0, slabs: [{ upTo: null, rate: 0 }] } })).status, 403);
  assert.equal((await api('GET', '/api/v1/orders', { token: platformToken })).status, 403);
});
