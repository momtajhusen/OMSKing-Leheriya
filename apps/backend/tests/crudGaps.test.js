process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { hashPassword } = require('../src/lib/password');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const Order = require('../src/models/Order');
const MasterSku = require('../src/models/MasterSku');
const RefreshSession = require('../src/models/RefreshSession');
const ChannelConnection = require('../src/models/ChannelConnection');
const SubscriptionPayment = require('../src/models/SubscriptionPayment');
const AuditLog = require('../src/models/AuditLog');

const PASSWORD = 'Password1';

let memory;
let server;
let base;
let platformToken;
let leheriya;
let surat;
let ownerToken;

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
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  return { status: res.status, body };
}

async function login(email, password = PASSWORD) {
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken;
}

async function staff(created, code, email, extra = {}) {
  const role = created.roles.find((row) => row.code === code);
  return User.create({
    tenantId: created.tenant._id,
    fullName: `${code} person`,
    email,
    passwordHash: await hashPassword(PASSWORD),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
    ...extra,
  });
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await AuditLog.syncIndexes();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const platform = await Tenant.create({ name: 'OMSKing SaaS', slug: 'platform-crud', kind: 'platform', status: 'active' });
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
    email: 'platform-crud@omsking.com',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });
  platformToken = await login('platform-crud@omsking.com');

  leheriya = await provisionMerchant({ name: 'Leheriya Crud', ownerEmail: 'owner-crud@example.com', ownerName: 'Owner', password: PASSWORD, status: 'active' });
  surat = await provisionMerchant({ name: 'Surat Crud', ownerEmail: 'surat-crud@example.com', ownerName: 'Surat Owner', password: PASSWORD, status: 'active' });
  ownerToken = await login('owner-crud@example.com');
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('super admin can delete a user added by mistake; their sessions end and the delete is audited', async () => {
  const ops = await staff(leheriya, 'operations', 'ops-mistake@example.com');
  await login('ops-mistake@example.com');
  assert.ok(await RefreshSession.countDocuments({ userId: ops._id }).setOptions({ skipTenantFilter: true }) > 0);

  const impact = await api('GET', `/api/v1/users/${ops._id}/delete-impact`, { token: ownerToken });
  assert.equal(impact.status, 200, JSON.stringify(impact.body));
  const sessions = impact.body.data.removed.find((row) => row.key === 'sessions');
  assert.ok(sessions && sessions.count > 0, 'sessions listed as removed');
  assert.equal(impact.body.data.needsConfirm, true);

  const unconfirmed = await api('DELETE', `/api/v1/users/${ops._id}`, { token: ownerToken });
  assert.equal(unconfirmed.status, 409, JSON.stringify(unconfirmed.body));
  assert.equal(await User.countDocuments({ _id: ops._id }).setOptions({ skipTenantFilter: true }), 1);

  const removed = await api('DELETE', `/api/v1/users/${ops._id}`, { token: ownerToken, json: { confirmLinkedData: true } });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(await User.countDocuments({ _id: ops._id }).setOptions({ skipTenantFilter: true }), 0);
  assert.equal(await RefreshSession.countDocuments({ userId: ops._id }).setOptions({ skipTenantFilter: true }), 0);
  const audit = await AuditLog.findOne({ action: 'user.deleted', resourceId: ops._id }).setOptions({ skipTenantFilter: true });
  assert.ok(audit, 'user.deleted audit row');
  assert.equal(JSON.stringify(audit).includes('passwordHash'), false);

  const again = await api('DELETE', `/api/v1/users/${ops._id}`, { token: ownerToken });
  assert.equal(again.status, 404);
});

test('a user with no linked data deletes without the extra confirm; impact is tenant scoped', async () => {
  const fresh = await staff(leheriya, 'accounts', 'fresh-nolinks@example.com');
  const impact = await api('GET', `/api/v1/users/${fresh._id}/delete-impact`, { token: ownerToken });
  assert.equal(impact.status, 200, JSON.stringify(impact.body));
  assert.equal(impact.body.data.needsConfirm, false);
  const removed = await api('DELETE', `/api/v1/users/${fresh._id}`, { token: ownerToken });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const other = await api('GET', `/api/v1/users/${surat.owner._id}/delete-impact`, { token: ownerToken });
  assert.equal(other.status, 404);
});

test('a user cannot delete themselves, another company\'s user, or anyone without users.manage', async () => {
  const self = await api('DELETE', `/api/v1/users/${leheriya.owner._id}`, { token: ownerToken });
  assert.equal(self.status, 400);
  assert.equal(await User.countDocuments({ _id: leheriya.owner._id }).setOptions({ skipTenantFilter: true }), 1);

  const other = await api('DELETE', `/api/v1/users/${surat.owner._id}`, { token: ownerToken });
  assert.equal(other.status, 404);
  assert.equal(await User.countDocuments({ _id: surat.owner._id }).setOptions({ skipTenantFilter: true }), 1);

  await staff(leheriya, 'operations', 'ops-nodelete@example.com');
  const opsToken = await login('ops-nodelete@example.com');
  const target = await staff(leheriya, 'accounts', 'accounts-keep@example.com');
  const refused = await api('DELETE', `/api/v1/users/${target._id}`, { token: opsToken });
  assert.equal(refused.status, 403);
});

test('the last super admin cannot be deleted', async () => {
  const second = await staff(leheriya, 'super_admin', 'second-super@example.com');
  const secondToken = await login('second-super@example.com');
  const firstGone = await api('DELETE', `/api/v1/users/${leheriya.owner._id}`, { token: secondToken, json: { confirmLinkedData: true } });
  assert.equal(firstGone.status, 200, JSON.stringify(firstGone.body));
  const accounts = leheriya.roles.find((row) => row.code === 'accounts');
  await Role.updateOne({ _id: accounts._id }, { $addToSet: { permissions: 'users.manage' } }).setOptions({ skipTenantFilter: true });
  await staff(leheriya, 'accounts', 'accounts-lastsuper@example.com');
  const accountsToken = await login('accounts-lastsuper@example.com');
  const last = await api('DELETE', `/api/v1/users/${second._id}`, { token: accountsToken, json: { confirmLinkedData: true } });
  assert.equal(last.status, 400, JSON.stringify(last.body));
  assert.equal(await User.countDocuments({ _id: second._id }).setOptions({ skipTenantFilter: true }), 1);
  await Role.updateOne({ _id: accounts._id }, { $pull: { permissions: 'users.manage' } }).setOptions({ skipTenantFilter: true });
  ownerToken = secondToken;
});

test('signing in turns an invited user active, and an invited user who already signed in lists as Active', async () => {
  const invited = await staff(leheriya, 'accounts', 'invited-crud@example.com', { status: 'invited' });
  await login('invited-crud@example.com');
  const after = await User.findById(invited._id).setOptions({ skipTenantFilter: true });
  assert.equal(after.status, 'active');

  await staff(leheriya, 'accounts', 'invited-old@example.com', { status: 'invited', lastLoginAt: new Date('2026-09-09T14:19:15Z') });
  const list = await api('GET', '/api/v1/users?limit=100', { token: ownerToken });
  const row = list.body.data.find((item) => item.email === 'invited-old@example.com');
  assert.equal(row.status, 'Active');
});

test('a master SKU added by mistake can be deleted; one used on an order is discontinued instead', async () => {
  const created = await api('POST', '/api/v1/master-skus', { token: ownerToken, json: { name: 'Mistake Kurta', code: 'MISTAKE-1' } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const removed = await api('DELETE', `/api/v1/master-skus/${created.body.data.id}`, { token: ownerToken });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.data.deleted, true);
  assert.equal(await MasterSku.countDocuments({ _id: created.body.data.id }).setOptions({ skipTenantFilter: true }), 0);
  assert.ok(await AuditLog.findOne({ action: 'sku.deleted' }).setOptions({ skipTenantFilter: true }));

  const used = await api('POST', '/api/v1/master-skus', { token: ownerToken, json: { name: 'Sold Kurta', code: 'SOLD-1' } });
  await Order.create({
    tenantId: leheriya.tenant._id,
    orderNo: 'CRUD-ORDER-1',
    channel: 'Shopify',
    status: 'New',
    items: [{ name: 'Sold Kurta', sku: 'SOLD-1', qty: 1, price: 100, masterSkuId: used.body.data.id }],
  });
  const kept = await api('DELETE', `/api/v1/master-skus/${used.body.data.id}`, { token: ownerToken });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.equal(kept.body.data.deleted, false);
  const row = await MasterSku.findById(used.body.data.id).setOptions({ skipTenantFilter: true });
  assert.equal(row.status, 'discontinued');

  const suratToken = await login('surat-crud@example.com');
  const cross = await api('DELETE', `/api/v1/master-skus/${used.body.data.id}`, { token: suratToken });
  assert.equal(cross.status, 404);
});

test('one HSN row can be edited or deleted without uploading the whole file again', async () => {
  const uploaded = await api('POST', '/api/v1/settings/tax/hsn', {
    token: ownerToken,
    json: { rows: [{ hsn: '6109', description: 'T-shirts', gstRate: 5 }, { hsn: '6204', description: 'Kurtas', gstRate: 12 }] },
  });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));

  const edited = await api('PATCH', '/api/v1/settings/tax/hsn/6204', { token: ownerToken, json: { description: 'Women kurtas', gstRate: 5 } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const kurta = edited.body.data.hsnMaster.find((row) => row.hsn === '6204');
  assert.equal(kurta.description, 'Women kurtas');
  assert.equal(kurta.gstRate, 5);

  const removed = await api('DELETE', '/api/v1/settings/tax/hsn/6109', { token: ownerToken });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(removed.body.data.hsnMaster.map((row) => row.hsn), ['6204']);
  assert.equal(removed.body.data.hsnCount, 1);

  const missing = await api('DELETE', '/api/v1/settings/tax/hsn/9999', { token: ownerToken });
  assert.equal(missing.status, 404);
  const badRate = await api('PATCH', '/api/v1/settings/tax/hsn/6204', { token: ownerToken, json: { gstRate: 140 } });
  assert.equal(badRate.status, 400);
});

test('a channel can be disconnected: its saved keys are removed for this company only', async () => {
  await ChannelConnection.create({ tenantId: leheriya.tenant._id, channel: 'meesho', status: 'saved', credentialsEnc: 'encrypted-blob' });
  await ChannelConnection.create({ tenantId: surat.tenant._id, channel: 'meesho', status: 'saved', credentialsEnc: 'encrypted-blob' });
  const removed = await api('DELETE', '/api/v1/channels/meesho', { token: ownerToken });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(await ChannelConnection.countDocuments({ tenantId: leheriya.tenant._id, channel: 'meesho' }).setOptions({ skipTenantFilter: true }), 0);
  assert.equal(await ChannelConnection.countDocuments({ tenantId: surat.tenant._id, channel: 'meesho' }).setOptions({ skipTenantFilter: true }), 1);
  assert.ok(await AuditLog.findOne({ action: 'channel.disconnected' }).setOptions({ skipTenantFilter: true }));
  assert.equal(JSON.stringify(removed.body).includes('encrypted-blob'), false);

  const again = await api('DELETE', '/api/v1/channels/meesho', { token: ownerToken });
  assert.equal(again.status, 404);
  const unknown = await api('DELETE', '/api/v1/channels/ebay', { token: ownerToken });
  assert.equal(unknown.status, 400);
});

test('platform can undo a payment marked paid by mistake, but not a Razorpay payment', async () => {
  const marked = await api('POST', `/api/v1/pricing/subscriptions/${surat.tenant._id}/payments`, { token: platformToken, json: { amount: 500 } });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.equal(marked.body.data.monthStatus, 'paid');

  const undone = await api('DELETE', `/api/v1/pricing/subscriptions/${surat.tenant._id}/payments`, { token: platformToken });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.notEqual(undone.body.data.monthStatus, 'paid');
  assert.ok(await AuditLog.findOne({ action: 'subscription.payment_undone' }).setOptions({ skipTenantFilter: true }));

  await SubscriptionPayment.updateOne(
    { tenantId: surat.tenant._id, period: marked.body.data.period },
    { $set: { tenantId: surat.tenant._id, period: marked.body.data.period, amount: 500, status: 'paid', razorpayPaymentId: 'pay_test_123' } },
    { upsert: true },
  ).setOptions({ skipTenantFilter: true });
  const refused = await api('DELETE', `/api/v1/pricing/subscriptions/${surat.tenant._id}/payments`, { token: platformToken });
  assert.equal(refused.status, 400);

  const merchant = await api('DELETE', `/api/v1/pricing/subscriptions/${surat.tenant._id}/payments`, { token: ownerToken });
  assert.equal(merchant.status, 403);
});

test('platform can rename a subscriber and delete one created by mistake, but not one with orders', async () => {
  const renamed = await api('PATCH', `/api/v1/tenants/${surat.tenant._id}`, { token: platformToken, json: { name: 'Surat Silks Pvt Ltd' } });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.data.name, 'Surat Silks Pvt Ltd');
  const blank = await api('PATCH', `/api/v1/tenants/${surat.tenant._id}`, { token: platformToken, json: { name: ' ' } });
  assert.equal(blank.status, 400);

  const mistake = await provisionMerchant({ name: 'Typo Company', ownerEmail: 'typo-owner@example.com', ownerName: 'Typo', password: PASSWORD, status: 'trial' });
  const removed = await api('DELETE', `/api/v1/tenants/${mistake.tenant._id}`, { token: platformToken });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(await Tenant.countDocuments({ _id: mistake.tenant._id }), 0);
  assert.equal(await User.countDocuments({ tenantId: mistake.tenant._id }).setOptions({ skipTenantFilter: true }), 0);
  assert.equal(await Role.countDocuments({ tenantId: mistake.tenant._id }).setOptions({ skipTenantFilter: true }), 0);
  assert.ok(await AuditLog.findOne({ action: 'tenant.deleted' }).setOptions({ skipTenantFilter: true }));

  const busy = await api('DELETE', `/api/v1/tenants/${leheriya.tenant._id}`, { token: platformToken });
  assert.equal(busy.status, 409);
  assert.equal(await Tenant.countDocuments({ _id: leheriya.tenant._id }), 1);

  const merchant = await api('DELETE', `/api/v1/tenants/${surat.tenant._id}`, { token: ownerToken });
  assert.equal(merchant.status, 403);
});
