process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { hashPassword } = require('../src/lib/password');
const { signAccessToken } = require('../src/lib/tokens');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { recordAudit } = require('../src/services/auditLog.service');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const Order = require('../src/models/Order');
const app = require('../src/app');

const ORDER_NO = 'LEH-ORDER-77';
const SUB_ID = 'LEH-SUB-77';
const CUSTOMER = 'Hidden Leheriya Buyer';
const PHONE = '9811100771';
const GSTIN = '27LEHERIYA99Z9X';
const HSN = 'Leheriya secret hsn';
const AUDIT = 'LEH-AUDIT-SECRET';
const SURAT_ORDER = 'SUR-ORDER-1';

let memory;
let server;
let base;
let leheriya;
let surat;
let platform;
let vendorToken;
let suratToken;
let leheriyaToken;
let platformToken;
let suspendedCookie;

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

function packed(body) {
  return JSON.stringify(body || {});
}

function denies(status) {
  return status === 403 || status === 404;
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  leheriya = await provisionMerchant({
    name: 'Leheriya Silks',
    ownerEmail: `leheriya-${Date.now()}@example.com`,
    ownerName: 'Leheriya Owner',
    password: 'Password1',
    status: 'active',
  });
  leheriya.tenant.legalEntity = { ...(leheriya.tenant.legalEntity || {}), gstin: GSTIN, email: leheriya.owner.email };
  leheriya.tenant.settings = leheriya.tenant.settings || {};
  leheriya.tenant.settings.taxGst = {
    configured: true,
    defaultGstRate: 5,
    categories: [{ name: 'Leheriya Silk Only', gstRate: 5 }],
    hsnMaster: [{ hsn: '620443', description: HSN, gstRate: 5 }],
  };
  leheriya.tenant.markModified('legalEntity');
  leheriya.tenant.markModified('settings');
  await leheriya.tenant.save();
  await Order.create({
    tenantId: leheriya.tenant._id,
    orderNo: ORDER_NO,
    channel: 'Shopify',
    source: 'manual',
    customer: CUSTOMER,
    phone: PHONE,
    status: 'New',
    total: 499,
    items: [{ name: 'Bandhani', sku: 'LEH-SKU', qty: 1, price: 499, gst: 5 }],
    subOrders: [{ id: SUB_ID, index: 1, sku: 'LEH-SKU', title: 'Bandhani', qty: 1, price: 499, status: 'New' }],
  });
  await recordAudit({
    tenantId: leheriya.tenant._id,
    actorId: leheriya.owner._id,
    actorRole: 'super_admin',
    action: 'company.updated',
    resourceType: 'company',
    resourceId: leheriya.tenant._id,
    resourceDisplay: AUDIT,
    before: { gstin: '' },
    after: { gstin: GSTIN },
  });

  surat = await provisionMerchant({
    name: 'Surat Silks',
    ownerEmail: `surat-${Date.now()}@example.com`,
    ownerName: 'Surat Owner',
    password: 'Password1',
    status: 'active',
  });
  await Order.create({
    tenantId: surat.tenant._id,
    orderNo: SURAT_ORDER,
    channel: 'Shopify',
    source: 'manual',
    customer: 'Surat Buyer',
    phone: '9822200334',
    status: 'New',
    total: 100,
    items: [{ name: 'Saree', sku: 'SUR-SKU', qty: 1, price: 100 }],
    subOrders: [{ id: 'SUR-SUB-1', index: 1, sku: 'SUR-SKU', title: 'Saree', qty: 1, price: 100, status: 'New' }],
  });
  const vendorRole = surat.roles.find((role) => role.code === 'vendor');
  await User.create({
    tenantId: surat.tenant._id,
    fullName: 'Surat Vendor',
    email: `vendor-${Date.now()}@surat.test`,
    passwordHash: await hashPassword('Password1'),
    roleId: vendorRole._id,
    status: 'active',
    emailVerified: true,
  });

  const platformTenant = await Tenant.create({
    name: 'OMSKing SaaS',
    slug: `plat-${Date.now()}`,
    kind: 'platform',
    status: 'active',
  });
  const platformRole = await Role.create({
    tenantId: platformTenant._id,
    code: 'platform_admin',
    name: 'Platform Admin',
    permissions: ['tenants.manage', 'users.manage', 'settings.manage'],
    isSystem: true,
  });
  const platformUser = await User.create({
    tenantId: platformTenant._id,
    fullName: 'Platform Operator',
    email: `platform-${Date.now()}@omsking.test`,
    passwordHash: await hashPassword('Password1'),
    roleId: platformRole._id,
    status: 'active',
    emailVerified: true,
  });
  platform = { tenant: platformTenant, user: platformUser };

  const suratLogin = await api('POST', '/api/v1/auth/login', {
    json: { email: surat.owner.email, password: 'Password1', workspace: surat.tenant.slug },
  });
  assert.equal(suratLogin.status, 200);
  suratToken = suratLogin.body.data.accessToken;
  const leheriyaLogin = await api('POST', '/api/v1/auth/login', {
    json: { email: leheriya.owner.email, password: 'Password1', workspace: leheriya.tenant.slug },
  });
  leheriyaToken = leheriyaLogin.body.data.accessToken;
  const vendorUser = await User.findOne({ tenantId: surat.tenant._id, fullName: 'Surat Vendor' }).setOptions({ skipTenantFilter: true });
  const vendorLogin = await api('POST', '/api/v1/auth/login', {
    json: { email: vendorUser.email, password: 'Password1', workspace: surat.tenant.slug },
  });
  assert.equal(vendorLogin.status, 200);
  vendorToken = vendorLogin.body.data.accessToken;
  const platformLogin = await api('POST', '/api/v1/auth/login', {
    json: { email: platform.user.email, password: 'Password1' },
  });
  assert.equal(platformLogin.status, 200);
  platformToken = platformLogin.body.data.accessToken;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('orders, bills, GST, users and audit stay on the JWT company', async () => {
  const [suratOrders, leheriyaOrders] = await Promise.all([
    api('GET', '/api/v1/orders', { token: suratToken }),
    api('GET', '/api/v1/orders', { token: leheriyaToken }),
  ]);
  assert.equal(suratOrders.status, 200);
  assert.equal(leheriyaOrders.status, 200);
  assert.equal(packed(suratOrders.body).includes(ORDER_NO), false);
  assert.equal(packed(suratOrders.body).includes(CUSTOMER), false);
  assert.equal(packed(leheriyaOrders.body).includes(ORDER_NO), true);
  assert.equal(packed(leheriyaOrders.body).includes(SURAT_ORDER), false);

  const searched = await api('GET', `/api/v1/orders?q=${ORDER_NO}&tenantId=${leheriya.tenant._id}`, { token: suratToken });
  assert.equal(searched.status, 200);
  assert.deepEqual(searched.body.data, []);

  const byNo = await api('GET', `/api/v1/orders/${ORDER_NO}`, { token: suratToken });
  const bySub = await api('GET', `/api/v1/orders/${SUB_ID}`, { token: suratToken });
  const byId = await api('GET', `/api/v1/orders/${leheriya.tenant._id}`, { token: suratToken });
  const leheriyaOrder = await Order.findOne({ orderNo: ORDER_NO }).setOptions({ skipTenantFilter: true });
  const byMongo = await api('GET', `/api/v1/orders/${leheriyaOrder._id}`, { token: suratToken });
  for (const res of [byNo, bySub, byId, byMongo]) {
    assert.equal(denies(res.status), true, `expected 403 or 404, got ${res.status}`);
    assert.equal(packed(res.body).includes(CUSTOMER), false);
    assert.equal(packed(res.body).includes(PHONE), false);
  }

  const invoice = await api('POST', `/api/v1/orders/${ORDER_NO}/invoice`, {
    token: suratToken,
    json: { email: false, tenantId: String(leheriya.tenant._id) },
  });
  assert.equal(denies(invoice.status), true);
  assert.equal(packed(invoice.body).includes(GSTIN), false);

  const settlement = await api('POST', '/api/v1/finance/settlements', {
    token: suratToken,
    json: { source: 'amazon', csv: `order-id,gross\n${ORDER_NO},499\n` },
  });
  assert.equal(settlement.status, 200);
  assert.equal(settlement.body.data.rows[0].status, 'exception');
  assert.equal(packed(settlement.body).includes(CUSTOMER), false);
  assert.equal(packed(settlement.body).includes(PHONE), false);

  const returnsFile = await api('POST', '/api/v1/finance/returns', {
    token: suratToken,
    json: { csv: `order-id\n${ORDER_NO}\n` },
  });
  assert.equal(returnsFile.status, 200);
  assert.equal(packed(returnsFile.body).includes(CUSTOMER), false);

  const company = await api('GET', '/api/v1/settings/company', { token: suratToken });
  const tax = await api('GET', '/api/v1/settings/tax', { token: suratToken });
  const bill = await api('GET', '/api/v1/pricing/mine', { token: suratToken });
  const stock = await api('GET', '/api/v1/inventory', { token: suratToken });
  for (const res of [company, tax, bill, stock]) {
    assert.equal(res.status, 200);
    assert.equal(packed(res.body).includes(GSTIN), false);
    assert.equal(packed(res.body).includes(HSN), false);
    assert.equal(packed(res.body).includes(CUSTOMER), false);
    assert.equal(packed(res.body).includes('Leheriya Silks'), false);
  }
  const ownGst = await api('GET', '/api/v1/settings/company', { token: leheriyaToken });
  assert.equal(ownGst.body.data.gstin, GSTIN);

  const users = await api('GET', `/api/v1/users?tenantId=${leheriya.tenant._id}`, { token: suratToken });
  assert.equal(users.status, 200);
  assert.equal(packed(users.body).includes(leheriya.owner.email), false);
  assert.equal(users.body.data.some((row) => row.email === surat.owner.email), true);
  const userSearch = await api('GET', `/api/v1/users?q=${encodeURIComponent(leheriya.owner.email)}`, { token: suratToken });
  assert.equal(userSearch.status, 200);
  assert.deepEqual(userSearch.body.data, []);
  const patched = await api('PATCH', `/api/v1/users/${leheriya.owner._id}`, {
    token: suratToken,
    json: { name: 'Taken Over' },
  });
  assert.equal(denies(patched.status), true);
  const still = await User.findById(leheriya.owner._id).setOptions({ skipTenantFilter: true });
  assert.equal(still.fullName, 'Leheriya Owner');

  const audit = await api('GET', `/api/v1/audit-logs?q=${AUDIT}`, { token: suratToken });
  assert.equal(audit.status, 200);
  assert.equal(packed(audit.body).includes(AUDIT), false);
  assert.equal(packed(audit.body).includes(GSTIN), false);
  const ownAudit = await api('GET', `/api/v1/audit-logs?q=${AUDIT}`, { token: leheriyaToken });
  assert.equal(packed(ownAudit.body).includes(AUDIT), true);
});

test('a token whose company claim is not the user company is rejected', async () => {
  const forged = signAccessToken({
    sub: String(surat.owner._id),
    role: 'super_admin',
    permissions: ['orders.view', 'finance.view', 'settings.manage', 'users.manage'],
    tenantId: String(leheriya.tenant._id),
    impersonating: false,
    rv: 0,
  });
  const res = await api('GET', '/api/v1/orders', { token: forged });
  assert.equal(res.status, 403);
  assert.equal(packed(res.body).includes(ORDER_NO), false);
  assert.equal(packed(res.body).includes(CUSTOMER), false);
});

test('vendor is forbidden on dashboard and users-roles APIs', async () => {
  const denied = await Promise.all([
    api('GET', '/api/v1/users', { token: vendorToken }),
    api('GET', '/api/v1/roles', { token: vendorToken }),
    api('GET', '/api/v1/audit-logs', { token: vendorToken }),
    api('GET', '/api/v1/inventory/alerts', { token: vendorToken }),
    api('GET', '/api/v1/integrations/jobs', { token: vendorToken }),
    api('GET', '/api/v1/settings/company', { token: vendorToken }),
    api('GET', '/api/v1/settings/tax', { token: vendorToken }),
    api('POST', `/api/v1/orders/${SURAT_ORDER}/invoice`, { token: vendorToken, json: { email: false } }),
  ]);
  for (const res of denied) {
    assert.equal(res.status, 403);
    assert.equal(packed(res.body).includes(CUSTOMER), false);
    assert.equal(packed(res.body).includes(GSTIN), false);
  }
  const orders = await api('GET', '/api/v1/orders', { token: vendorToken });
  assert.equal(orders.status, 200);
  assert.deepEqual(orders.body.data, []);
});

test('platform open tenant then back does not leave Leheriya orders on the platform list', async () => {
  const opened = await api('POST', `/api/v1/tenants/${leheriya.tenant._id}/impersonate`, { token: platformToken });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.data.user.impersonating, true);
  assert.equal(opened.body.data.user.tenantName, 'Leheriya Silks');
  const inside = await api('GET', '/api/v1/orders', { token: opened.body.data.accessToken });
  assert.equal(inside.status, 200);
  assert.equal(packed(inside.body).includes(ORDER_NO), true);

  const left = await api('POST', '/api/v1/auth/exit-impersonation', { token: opened.body.data.accessToken });
  assert.equal(left.status, 200);
  assert.equal(left.body.data.user.impersonating, false);
  assert.equal(left.body.data.user.tenantId, String(platform.tenant._id));
  const platformAccess = left.body.data.accessToken;

  const subscribers = await api('GET', '/api/v1/tenants', { token: platformAccess });
  assert.equal(subscribers.status, 200);
  assert.equal(subscribers.body.data.some((row) => row.name === 'Leheriya Silks'), true);
  assert.equal(packed(subscribers.body).includes(ORDER_NO), false);
  assert.equal(packed(subscribers.body).includes(CUSTOMER), false);
  assert.equal(packed(subscribers.body).includes(PHONE), false);
  assert.equal(packed(subscribers.body).includes(GSTIN), false);

  const orders = await api('GET', '/api/v1/orders', { token: platformAccess });
  assert.equal(orders.status === 400 || orders.status === 403, true);
  assert.equal(packed(orders.body).includes(ORDER_NO), false);
  assert.equal(packed(orders.body).includes(CUSTOMER), false);
  const audit = await api('GET', '/api/v1/audit-logs', { token: platformAccess });
  assert.equal(audit.status, 400);
  assert.equal(packed(audit.body).includes(AUDIT), false);
});

test('a suspended company cannot sign in and its existing tokens are rejected', async () => {
  const email = `paused-${Date.now()}@example.com`;
  const created = await provisionMerchant({
    name: 'Paused Silks',
    ownerEmail: email,
    ownerName: 'Paused Owner',
    password: 'Password1',
    status: 'active',
  });
  await Order.create({
    tenantId: created.tenant._id,
    orderNo: 'PAUSE-1',
    channel: 'Shopify',
    source: 'manual',
    customer: 'Paused Buyer',
    status: 'New',
    items: [{ name: 'Shawl', sku: 'P1', qty: 1, price: 10 }],
    subOrders: [{ id: 'PAUSE-1-1', index: 1, sku: 'P1', title: 'Shawl', qty: 1, price: 10, status: 'New' }],
  });
  const signed = await api('POST', '/api/v1/auth/login', {
    json: { email, password: 'Password1', workspace: created.tenant.slug },
  });
  assert.equal(signed.status, 200);
  const token = signed.body.data.accessToken;
  suspendedCookie = signed.cookie;
  created.tenant.status = 'suspended';
  await created.tenant.save();

  const again = await api('POST', '/api/v1/auth/login', {
    json: { email, password: 'Password1', workspace: created.tenant.slug },
  });
  assert.equal(again.status, 403);
  assert.match(again.body.message, /suspended/i);
  assert.equal(packed(again.body).includes('accessToken'), false);

  const blocked = await Promise.all([
    api('GET', '/api/v1/orders', { token }),
    api('GET', '/api/v1/auth/me', { token }),
    api('GET', '/api/v1/settings/company', { token }),
    api('GET', '/api/v1/users', { token }),
    api('GET', '/api/v1/audit-logs', { token }),
    api('GET', '/api/v1/pricing/mine', { token }),
  ]);
  for (const res of blocked) {
    assert.equal(res.status, 403);
    assert.match(res.body.message, /suspended/i);
    assert.equal(packed(res.body).includes('Paused Buyer'), false);
  }

  const refreshed = await api('POST', '/api/v1/auth/refresh', { cookie: suspendedCookie });
  assert.equal(refreshed.status, 403);
  assert.match(refreshed.body.message, /suspended/i);
  assert.equal(packed(refreshed.body).includes('accessToken'), false);
});
