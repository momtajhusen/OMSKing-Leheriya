process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Vendor = require('../src/models/Vendor');
const MasterSku = require('../src/models/MasterSku');
const orders = require('../src/controllers/orders.controller');
const { saveNotificationSettings, notifyVendorAssigned, scanOverdueDispatches } = require('../src/services/notify.service');

let memory;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(tenant, handler, req) {
  const res = fakeRes();
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false, userId: null }, () => handler({
    tenantId: String(tenant._id),
    user: { id: null, role: 'super_admin' },
    params: {},
    query: {},
    body: {},
    ...req,
  }, res));
  return res.body?.data;
}

function vendorReq(vendorId, extra = {}) {
  return {
    user: { id: null, role: 'vendor', assignedVendorIds: [vendorId] },
    vendorScope: { active: true, assignedVendorIds: [String(vendorId)] },
    ...extra,
  };
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await Promise.all([Order.syncIndexes(), Vendor.syncIndexes()]);
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('vendor A does not see vendor B, and both of A lines take one tracking number', async () => {
  const tenant = await Tenant.create({ name: 'Sheet shop', slug: `sheet-${Date.now()}`, kind: 'merchant' });
  const raj = await Vendor.create({ tenantId: tenant._id, name: 'Raj Prints', nameNorm: 'raj prints', phone: '919111111111' });
  const meera = await Vendor.create({ tenantId: tenant._id, name: 'Meera Looms', nameNorm: 'meera looms', phone: '919333333333' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: 'K1', name: 'Kurta' });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-BULK',
    channel: 'Shopify',
    source: 'manual',
    customer: 'Buyer',
    phone: '9000000000',
    status: 'New',
    items: [
      { name: 'Kurta', sku: 'K1', qty: 1, price: 1000, masterSkuId: sku._id },
      { name: 'Dupatta', sku: 'D1', qty: 1, price: 500, masterSkuId: sku._id },
      { name: 'Stole', sku: 'S1', qty: 1, price: 400, masterSkuId: sku._id },
    ],
    subOrders: [
      { id: 'SHP-BULK-1', index: 1, sku: 'K1', title: 'Kurta', price: 1000, masterSkuId: sku._id },
      { id: 'SHP-BULK-2', index: 2, sku: 'D1', title: 'Dupatta', price: 500, masterSkuId: sku._id },
      { id: 'SHP-BULK-3', index: 3, sku: 'S1', title: 'Stole', price: 400, masterSkuId: sku._id },
    ],
  });
  await call(tenant, orders.assignSubOrder, { params: { orderId: 'SHP-BULK', subOrderId: 'SHP-BULK-1' }, body: { assignedVendor: 'Raj Prints' } });
  await call(tenant, orders.assignSubOrder, { params: { orderId: 'SHP-BULK', subOrderId: 'SHP-BULK-2' }, body: { assignedVendor: 'Raj Prints' } });
  await call(tenant, orders.assignSubOrder, { params: { orderId: 'SHP-BULK', subOrderId: 'SHP-BULK-3' }, body: { assignedVendor: 'Meera Looms' } });

  const mine = await call(tenant, orders.listOrders, vendorReq(raj._id));
  assert.deepEqual(mine[0].subOrders.map((row) => row.id).sort(), ['SHP-BULK-1', 'SHP-BULK-2']);
  assert.equal(JSON.stringify(mine).includes('SHP-BULK-3'), false);
  assert.equal(JSON.stringify(mine).includes('9000000000'), false);

  for (const id of ['SHP-BULK-1', 'SHP-BULK-2']) {
    await call(tenant, orders.vendorUpdate, vendorReq(raj._id, {
      params: { orderId: 'SHP-BULK', subOrderId: id },
      body: { action: 'accept' },
    }));
    await call(tenant, orders.vendorUpdate, vendorReq(raj._id, {
      params: { orderId: 'SHP-BULK', subOrderId: id },
      body: { action: 'dispatch', trackingNumber: 'AWB-ONE', courier: 'Delhivery' },
    }));
  }

  const after = await call(tenant, orders.listOrders, vendorReq(raj._id));
  assert.equal(after[0].subOrders.every((row) => row.trackingNumber === 'AWB-ONE' && row.vendorStatus === 'Dispatched'), true);
  const hers = await call(tenant, orders.listOrders, vendorReq(meera._id));
  assert.deepEqual(hers[0].subOrders.map((row) => row.id), ['SHP-BULK-3']);
  assert.equal(hers[0].subOrders[0].trackingNumber || '', '');
});

test('saved telegram group receives the assign, and the owner chat does not', async () => {
  const tenant = await Tenant.create({ name: 'Group shop', slug: `grp-${Date.now()}`, kind: 'merchant' });
  await Vendor.create({
    tenantId: tenant._id,
    name: 'Raj Prints',
    nameNorm: 'raj prints',
    telegramGroup: '-100111',
  });
  await saveNotificationSettings(tenant._id, {
    botToken: 'bot-test-token',
    ownerChatId: '-100222',
    events: { 'NOT-002': { telegram: true, email: false, whatsapp: false, other: false } },
  });
  const order = await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-TG',
    source: 'manual',
    subOrders: [{ id: 'SHP-TG-1', index: 1, sku: 'SKU-1', qty: 1, assignedVendor: 'Raj Prints' }],
  });
  const calls = [];
  const result = await notifyVendorAssigned(tenant._id, order, order.subOrders[0], {
    telegram: async ({ chatId, text }) => {
      calls.push({ chatId, text });
      return `msg-${calls.length}`;
    },
    mailer: async () => ({ messageId: 'm' }),
  });
  assert.equal(result.telegram, 'sent');
  assert.equal(result.ownerTelegram, 'sent');
  assert.equal(calls.filter((row) => row.chatId === '-100111').length, 1);
  assert.equal(calls.filter((row) => row.chatId === '-100222').length, 1);
  assert.equal(calls[0].chatId, '-100111');
  assert.match(calls.find((row) => row.chatId === '-100111').text, /Order: SHP-TG/);
});

test('NOT-010 off sends nothing, and on WhatsApp goes to the vendor phone', async () => {
  const tenant = await Tenant.create({ name: 'Late shop', slug: `late-${Date.now()}`, kind: 'merchant' });
  await saveNotificationSettings(tenant._id, {
    whatsappPhoneNumberId: '555',
    whatsappToken: 'wa-secret',
    whatsappTo: '919000000000',
    events: { 'NOT-010': { email: false, telegram: false, whatsapp: false, other: false } },
  });
  await Vendor.create({ tenantId: tenant._id, name: 'Raj Prints', nameNorm: 'raj prints', phone: '+91 91111 11111' });
  await Vendor.create({ tenantId: tenant._id, name: 'Meera Looms', nameNorm: 'meera looms', phone: '919333333333' });
  const old = daysAgo(8);
  const fresh = daysAgo(1);
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-LATE',
    source: 'manual',
    subOrders: [
      { id: 'LATE-1', index: 1, sku: 'K1', qty: 2, assignedVendor: 'Raj Prints', assignedDate: old, vendorStatus: 'Accepted' },
      { id: 'LATE-2', index: 2, sku: 'D1', qty: 1, assignedVendor: 'Raj Prints', assignedDate: fresh, vendorStatus: 'Accepted' },
      { id: 'LATE-3', index: 3, sku: 'S1', qty: 1, assignedVendor: 'Raj Prints', assignedDate: old, vendorStatus: 'Dispatched', dispatchDate: old },
      { id: 'LATE-4', index: 4, sku: 'M1', qty: 1, assignedVendor: 'Meera Looms', assignedDate: old, vendorStatus: 'Accepted' },
    ],
  });
  const calls = [];
  const transport = {
    force: true,
    whatsapp: async (payload) => { calls.push(payload); return `wa-${calls.length}`; },
    mailer: async () => { throw new Error('mail should stay off'); },
    telegram: async () => { throw new Error('telegram should stay off'); },
  };
  const quiet = await scanOverdueDispatches(transport);
  assert.equal(quiet, 0);
  assert.equal(calls.length, 0);

  await saveNotificationSettings(tenant._id, {
    events: { 'NOT-010': { email: false, telegram: false, whatsapp: true, other: false } },
  });
  const sent = await scanOverdueDispatches(transport);
  assert.equal(sent, 2);
  assert.equal(calls.length, 2);
  const raj = calls.find((row) => row.to === '919111111111');
  const meera = calls.find((row) => row.to === '919333333333');
  assert.ok(raj);
  assert.ok(meera);
  assert.match(raj.text, /^\*OMSKing\*/);
  assert.match(raj.text, /Please dispatch this item urgently/);
  assert.match(raj.text, /SKU: K1/);
  assert.equal(calls.some((row) => row.to === '919000000000'), false);
  assert.equal(calls.some((row) => row.text.includes('LATE-2') || row.text.includes('LATE-3')), false);

  const again = await scanOverdueDispatches(transport);
  assert.equal(again, 0);
  assert.equal(calls.length, 2);
});
