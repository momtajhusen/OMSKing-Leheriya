process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Vendor = require('../src/models/Vendor');
const NotificationDelivery = require('../src/models/NotificationDelivery');
const { saveNotificationSettings, notifyVendorAssigned, notifyEventEmail, publicSettings, recentAlerts, loadTenant } = require('../src/services/notify.service');
const { applyTracking } = require('../src/services/tracking.service');
const { vendorUpdate } = require('../src/controllers/orders.controller');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

async function shop() {
  const tenant = await Tenant.create({
    name: 'Notify shop',
    slug: `notify-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: 'merchant',
    legalEntity: { email: 'ops@example.com' },
  });
  await saveNotificationSettings(tenant._id, { botToken: 'bot-test-token' });
  await Vendor.create({
    tenantId: tenant._id,
    name: 'Raj Prints',
    nameNorm: 'raj prints',
    email: 'raj@example.com',
    telegramGroup: 'https://t.me/rajprints',
  });
  const order = await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-1',
    channel: 'Shopify',
    phone: '9999911111',
    customer: 'Hidden Customer',
    address: 'Hidden address',
    source: 'manual',
    channelLines: [{ sku: 'SKU-1', shipByTime: new Date('2026-10-12T00:00:00Z') }],
    subOrders: [{
      id: 'SHP-1-1',
      index: 1,
      sku: 'SKU-1',
      qty: 2,
      assignedVendor: 'Raj Prints',
    }],
  });
  return { tenant, order };
}

test('one vendor assign sends one Telegram message and a retry does not send another', async () => {
  const { tenant, order } = await shop();
  const sub = order.subOrders[0];
  const calls = [];
  const telegram = async ({ token, chatId, text }) => {
    calls.push({ token, chatId, text });
    return 'msg-41';
  };
  const blocked = await notifyVendorAssigned(tenant._id, order, sub, { telegram, mailer: async () => ({ messageId: 'mail-0' }) });
  assert.equal(blocked.telegram, 'skipped');
  assert.equal(blocked.reason, 'off');
  assert.equal(calls.length, 0);
  await saveNotificationSettings(tenant._id, { events: { 'NOT-002': { telegram: true, email: false, whatsapp: false, other: false } } });
  const first = await notifyVendorAssigned(tenant._id, order, sub, { telegram, mailer: async () => ({ messageId: 'mail-1' }) });
  const second = await notifyVendorAssigned(tenant._id, order, sub, { telegram, mailer: async () => ({ messageId: 'mail-2' }) });
  const row = await NotificationDelivery.findOne({ tenantId: tenant._id, channel: 'telegram' }).setOptions({ skipTenantFilter: true });
  assert.equal(first.telegram, 'sent');
  assert.equal(second.telegram, 'already_sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, '@rajprints');
  assert.match(calls[0].text, /Order: SHP-1/);
  assert.match(calls[0].text, /SKU: SKU-1/);
  assert.match(calls[0].text, /Qty: 2/);
  assert.match(calls[0].text, /Ship-by: 2026-10-12/);
  assert.equal(calls[0].text.includes('9999911111'), false);
  assert.equal(calls[0].text.includes('Hidden'), false);
  assert.equal(row.sendId, 'msg-41');
  assert.equal(row.status, 'sent');
});

test('email goes only for an event that is switched on, and a retry keeps the same send id', async () => {
  const { tenant, order } = await shop();
  const sub = order.subOrders[0];
  const mails = [];
  const mailer = async (payload) => {
    mails.push(payload);
    return { messageId: 'mail-9' };
  };
  await notifyVendorAssigned(tenant._id, order, sub, { telegram: async () => 'msg-1', mailer });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'ops@example.com');
  await saveNotificationSettings(tenant._id, { events: { 'NOT-002': { email: true, telegram: false, whatsapp: true } } });
  await notifyVendorAssigned(tenant._id, order, sub, { telegram: async () => 'msg-2', mailer });
  assert.equal(mails.length, 2);
  assert.equal(mails[1].to, 'raj@example.com');
  assert.equal(mails[1].text.includes('9999911111'), false);
  const vendorMail = await NotificationDelivery.findOne({ tenantId: tenant._id, channel: 'email', dedupeKey: /vendor-email/ }).setOptions({ skipTenantFilter: true });
  assert.equal(vendorMail.sendId, 'mail-9');
  const off = await notifyEventEmail(tenant._id, 'NOT-001', {
    dedupeKey: 'order.new:SHP-1',
    subject: 'New order SHP-1',
    text: 'Order: SHP-1\nChannel: Shopify',
  }, { mailer });
  assert.equal(off.reason, 'off');
  assert.equal(mails.length, 2);
});

test('a missing bot token does not call Telegram', async () => {
  const tenant = await Tenant.create({
    name: 'No bot',
    slug: `nobot-${Date.now()}`,
    kind: 'merchant',
  });
  await Vendor.create({
    tenantId: tenant._id,
    name: 'Raj Prints',
    nameNorm: 'raj prints',
    telegramGroup: '-100123',
  });
  const order = await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-2',
    source: 'manual',
    subOrders: [{ id: 'SHP-2-1', index: 1, sku: 'SKU-9', qty: 1, assignedVendor: 'Raj Prints' }],
  });
  await saveNotificationSettings(tenant._id, { events: { 'NOT-002': { telegram: true, email: false, whatsapp: false, other: false } } });
  let called = 0;
  const result = await notifyVendorAssigned(tenant._id, order, order.subOrders[0], {
    telegram: async () => { called += 1; return 'x'; },
    mailer: async () => ({ messageId: 'm' }),
  });
  assert.equal(result.telegram, 'skipped');
  assert.equal(result.reason, 'no_bot_token');
  assert.equal(called, 0);
  const saved = await saveNotificationSettings(tenant._id, { botToken: 'should-not-echo' });
  assert.equal(saved.botConfigured, true);
  assert.equal(JSON.stringify(saved).includes('should-not-echo'), false);
});

test('saved Gmail and WhatsApp receive the event, and the secrets are not returned', async () => {
  const { tenant } = await shop();
  const saved = await saveNotificationSettings(tenant._id, {
    gmailUser: 'alerts@example.com',
    gmailAppPassword: 'app-pass',
    whatsappPhoneNumberId: '12345',
    whatsappToken: 'wa-secret',
    whatsappTo: '+91 98765 43210',
    events: { 'NOT-001': { email: true, whatsapp: true, telegram: false, other: false } },
  });
  assert.equal(saved.gmailUser, 'alerts@example.com');
  assert.equal(saved.mailConfigured, true);
  assert.equal(saved.whatsappTo, '919876543210');
  assert.equal(saved.whatsappPhoneNumberId, '12345');
  assert.equal(saved.whatsappConfigured, true);
  assert.equal(JSON.stringify(saved).includes('wa-secret'), false);
  assert.equal(JSON.stringify(saved).includes('app-pass'), false);
  const mails = [];
  const was = [];
  const first = await notifyEventEmail(tenant._id, 'NOT-001', {
    dedupeKey: 'order.new:SHP-1',
    subject: 'New order SHP-1',
    text: 'Order: SHP-1\nChannel: Shopify',
  }, {
    mailer: async (payload) => { mails.push(payload); return { messageId: 'mail-wa' }; },
    whatsapp: async (payload) => { was.push(payload); return 'wamid-1'; },
  });
  assert.equal(first.email, 'sent');
  assert.equal(first.whatsapp, 'sent');
  assert.equal(mails[0].to, 'alerts@example.com');
  assert.equal(was[0].to, '919876543210');
  assert.equal(was[0].phoneNumberId, '12345');
  assert.equal(was[0].token, 'wa-secret');
  const again = await notifyEventEmail(tenant._id, 'NOT-001', {
    dedupeKey: 'order.new:SHP-1',
    subject: 'New order SHP-1',
    text: 'Order: SHP-1\nChannel: Shopify',
  }, {
    mailer: async (payload) => { mails.push(payload); return { messageId: 'mail-wa-2' }; },
    whatsapp: async (payload) => { was.push(payload); return 'wamid-2'; },
  });
  assert.equal(again.email, 'already_sent');
  assert.equal(again.whatsapp, 'already_sent');
  assert.equal(mails.length, 1);
  assert.equal(was.length, 1);
  const telegrams = [];
  await saveNotificationSettings(tenant._id, {
    ownerChatId: '-100555',
    events: { 'NOT-001': { email: false, whatsapp: false, telegram: true, other: true } },
  });
  const ping = await notifyEventEmail(tenant._id, 'NOT-001', {
    dedupeKey: 'order.new:SHP-9',
    subject: 'New order SHP-9',
    text: 'Order: SHP-9\nChannel: Shopify',
  }, { telegram: async ({ chatId, text }) => { telegrams.push({ chatId, text }); return 'tg-9'; } });
  assert.equal(ping.telegram, 'sent');
  assert.equal(ping.inApp, 'sent');
  assert.equal(ping.email, 'skipped');
  assert.equal(telegrams[0].chatId, '-100555');
  assert.equal(telegrams[0].text.includes('Hidden'), false);
  const quiet = await notifyEventEmail(tenant._id, 'NOT-003', {
    dedupeKey: 'dispatch:SHP-9',
    subject: 'Dispatched SHP-9',
    text: 'Order: SHP-9',
  }, { telegram: async () => { telegrams.push({ extra: true }); return 'tg-x'; } });
  assert.equal(quiet.telegram, 'skipped');
  assert.equal(telegrams.length, 1);
});

function captureTransports() {
  const mails = [];
  const telegrams = [];
  const whatsapps = [];
  return {
    mails,
    telegrams,
    whatsapps,
    deps: {
      mailer: async (payload) => {
        mails.push(payload);
        return { messageId: `mail-${mails.length}` };
      },
      telegram: async (payload) => {
        telegrams.push(payload);
        return `tg-${telegrams.length}`;
      },
      whatsapp: async (payload) => {
        whatsapps.push(payload);
        return `wa-${whatsapps.length}`;
      },
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('NOT-003 on and NOT-004 off: dispatch sends one message and shipping sends none', async () => {
  const { tenant, order } = await shop();
  const saved = await saveNotificationSettings(tenant._id, {
    ownerChatId: '-100222',
    gmailUser: 'ops@example.com',
    gmailAppPassword: 'app-pass-word',
    whatsappPhoneNumberId: '555',
    whatsappToken: 'wa-secret-token',
    whatsappTo: '919000000000',
    events: {
      'NOT-003': { email: true, telegram: true, whatsapp: true, other: false },
    },
  });
  const not003 = saved.events.find((row) => row.id === 'NOT-003');
  const not004 = saved.events.find((row) => row.id === 'NOT-004');
  assert.equal(not003.email, true);
  assert.equal(not004.email, false);
  assert.equal(not004.telegram, false);
  assert.equal(not004.whatsapp, false);
  assert.equal(not004.other, false);
  assert.equal(JSON.stringify(saved).includes('bot-test-token'), false);
  assert.equal(JSON.stringify(saved).includes('wa-secret-token'), false);
  assert.equal(JSON.stringify(saved).includes('app-pass-word'), false);

  const onlyDispatch = await saveNotificationSettings(tenant._id, {
    events: { 'NOT-003': { email: true, telegram: false, whatsapp: false, other: false } },
  });
  assert.equal(onlyDispatch.events.find((row) => row.id === 'NOT-004').email, false);
  assert.equal(onlyDispatch.events.find((row) => row.id === 'NOT-005').email, false);

  order.subOrders[0].vendorStatus = 'Accepted';
  await order.save();
  const transport = captureTransports();
  const res = fakeRes();
  await vendorUpdate({
    tenantId: tenant._id,
    skipTenantFilter: false,
    params: { orderId: order.orderNo, subOrderId: order.subOrders[0].id },
    body: { action: 'dispatch', trackingNumber: 'AWB-C1', courier: 'Delhivery' },
    notifyDeps: transport.deps,
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(transport.mails.length, 1);
  assert.equal(transport.mails[0].to, 'ops@example.com');
  assert.equal(transport.mails[0].text.includes('9999911111'), false);
  assert.equal(transport.telegrams.length, 0);
  assert.equal(transport.whatsapps.length, 0);
  const inAppOff = await NotificationDelivery.countDocuments({ tenantId: tenant._id, channel: 'in_app', eventKey: 'NOT-003' }).setOptions({ skipTenantFilter: true });
  assert.equal(inAppOff, 0);

  const shipped = await applyTracking(tenant._id, {
    orderNo: order.orderNo,
    awb: 'AWB-C1',
    status: 'in_transit',
    detail: 'In transit',
    eventKey: 'evt-transit-1',
  }, transport.deps);
  assert.equal(shipped.duplicate, false);
  assert.equal(transport.mails.length, 1);
  const shippingRows = await NotificationDelivery.countDocuments({ tenantId: tenant._id, eventKey: 'NOT-004' }).setOptions({ skipTenantFilter: true });
  assert.equal(shippingRows, 0);

  await saveNotificationSettings(tenant._id, {
    events: { 'NOT-005': { email: true, telegram: false, whatsapp: false, other: true } },
  });
  await applyTracking(tenant._id, {
    orderNo: order.orderNo,
    awb: 'AWB-C1',
    status: 'delivered',
    detail: 'Delivered',
    eventKey: 'evt-delivered-1',
  }, transport.deps);
  assert.equal(transport.mails.length, 2);
  assert.match(transport.mails[1].subject, /Delivered/);
  const stillNoShipping = await NotificationDelivery.countDocuments({ tenantId: tenant._id, eventKey: 'NOT-004' }).setOptions({ skipTenantFilter: true });
  assert.equal(stillNoShipping, 0);
  const deliveredMail = await NotificationDelivery.countDocuments({ tenantId: tenant._id, eventKey: 'NOT-005', channel: 'email' }).setOptions({ skipTenantFilter: true });
  const deliveredInApp = await NotificationDelivery.countDocuments({ tenantId: tenant._id, eventKey: 'NOT-005', channel: 'in_app' }).setOptions({ skipTenantFilter: true });
  assert.equal(deliveredMail, 1);
  assert.equal(deliveredInApp, 1);
  const recent = await recentAlerts(tenant._id);
  assert.equal(recent.some((row) => row.channel === 'in_app' && row.eventKey === 'NOT-005'), true);
});

test('job failure stays with the company and each later event uses only its own switch', async () => {
  const { tenant, order } = await shop();
  await saveNotificationSettings(tenant._id, {
    ownerChatId: '-100222',
    gmailUser: 'ops@example.com',
    gmailAppPassword: 'app-pass-word',
    whatsappPhoneNumberId: '555',
    whatsappToken: 'wa-secret-token',
    whatsappTo: '919000000000',
    events: {
      'NOT-006': { email: false, telegram: false, whatsapp: true, other: false },
      'NOT-007': { email: true, telegram: false, whatsapp: false, other: false },
      'NOT-008': { email: true, telegram: true, whatsapp: true, other: false },
      'NOT-009': { email: false, telegram: false, whatsapp: false, other: false },
    },
  });
  const fresh = await loadTenant(tenant._id);
  const flags = publicSettings(fresh);
  const owner = flags.events.find((row) => row.id === 'NOT-009');
  assert.equal(owner.locked, true);
  assert.equal(owner.email, true);
  assert.equal(owner.telegram, true);
  assert.equal(owner.whatsapp, true);

  const transport = captureTransports();
  const failed = await notifyEventEmail(tenant._id, 'NOT-008', {
    dedupeKey: 'job.failed:abc',
    subject: 'Job failed orders_pull',
    text: 'Job: orders_pull\nfailed',
  }, transport.deps);
  assert.equal(failed.email, 'sent');
  assert.equal(failed.telegram, 'sent');
  assert.equal(failed.whatsapp, 'sent');
  assert.equal(failed.inApp, 'skipped');
  assert.equal(transport.mails[0].to, 'ops@example.com');
  assert.equal(transport.whatsapps[0].to, '919000000000');
  assert.equal(transport.telegrams[0].chatId, '-100222');
  assert.equal(transport.mails[0].text.includes(order.phone), false);
  assert.equal(transport.whatsapps[0].to === order.phone, false);

  const before = {
    mails: transport.mails.length,
    telegrams: transport.telegrams.length,
    whatsapps: transport.whatsapps.length,
  };
  await notifyEventEmail(tenant._id, 'NOT-006', {
    dedupeKey: 'return:RET-1',
    subject: 'Return RET-1',
    text: 'Return: RET-1',
  }, transport.deps);
  await notifyEventEmail(tenant._id, 'NOT-007', {
    dedupeKey: 'low:SKU-1:WH-001',
    subject: 'Low stock SKU-1',
    text: 'SKU: SKU-1\nAvailable: 1',
  }, transport.deps);
  assert.equal(transport.whatsapps.length, before.whatsapps + 1);
  assert.equal(transport.mails.length, before.mails + 1);
  assert.equal(transport.telegrams.length, before.telegrams);
  const inApp = await NotificationDelivery.countDocuments({ tenantId: tenant._id, channel: 'in_app' }).setOptions({ skipTenantFilter: true });
  assert.equal(inApp, 0);

  await saveNotificationSettings(tenant._id, {
    events: { 'NOT-002': { telegram: true, email: false, whatsapp: false, other: false } },
  });
  const calls = [];
  await notifyVendorAssigned(tenant._id, order, order.subOrders[0], {
    telegram: async ({ chatId }) => {
      calls.push(chatId);
      return 'tg-owner';
    },
    mailer: async () => ({ messageId: 'mail-owner' }),
    whatsapp: async () => 'wa-owner',
  });
  assert.equal(calls[0], '@rajprints');
  assert.equal(calls.includes('-100222'), true);
  assert.equal(calls.filter((chat) => chat === '-100222').length, 1);
});
