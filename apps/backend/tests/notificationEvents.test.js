process.env.NODE_ENV = 'test';
process.env.CHANNEL_ENCRYPTION_KEY = 'notification-events-test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Tenant = require('../src/models/Tenant');
const Vendor = require('../src/models/Vendor');
const Order = require('../src/models/Order');
const NotificationDelivery = require('../src/models/NotificationDelivery');
const { decryptObject } = require('../src/lib/secretBox');
const {
  saveNotificationSettings,
  notifyVendorAssigned,
  notifyEventEmail,
  recentAlerts,
  scanOverdueDispatches,
  loadTenant,
} = require('../src/services/notify.service');
const { applyTracking } = require('../src/services/tracking.service');
const { vendorUpdate } = require('../src/controllers/orders.controller');
const notifications = require('../src/controllers/notifications.controller');
const settings = require('../src/controllers/settings.controller');

const BOT = 'bot-test-token';
const GMAIL_PASS = 'app-pass-word';
const WA_TOKEN = 'wa-secret-token';
const COMPANY_MAIL = 'ops@company.test';
const CUSTOMER_MAIL = 'buyer@customer.test';
const CUSTOMER_PHONE = '9999911111';
const COMPANY_WA = '919000000000';
const OWNER_CHAT = '-100222';
const VENDOR_CHAT = '-100111';

let memory;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function capture() {
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

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await NotificationDelivery.syncIndexes();
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('NOT-003 on and NOT-004 off sends one dispatch message and nothing on the shipping update', async () => {
  const tenant = await Tenant.create({
    name: 'Dispatch shop',
    slug: `dispatch-${Date.now()}`,
    kind: 'merchant',
    legalEntity: { email: COMPANY_MAIL },
  });
  await Vendor.create({ tenantId: tenant._id, name: 'Raj Prints', nameNorm: 'raj prints', phone: '919111111111' });
  const order = await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-D1',
    channel: 'Shopify',
    source: 'manual',
    customer: 'Buyer',
    email: CUSTOMER_MAIL,
    phone: CUSTOMER_PHONE,
    subOrders: [{
      id: 'SHP-D1-1',
      index: 1,
      sku: 'K1',
      qty: 1,
      assignedVendor: 'Raj Prints',
      vendorStatus: 'Accepted',
    }],
  });
  const saved = await saveNotificationSettings(tenant._id, {
    ownerChatId: OWNER_CHAT,
    gmailUser: COMPANY_MAIL,
    gmailAppPassword: GMAIL_PASS,
    whatsappPhoneNumberId: '555',
    whatsappToken: WA_TOKEN,
    whatsappTo: COMPANY_WA,
    events: {
      'NOT-003': { email: true, telegram: false, whatsapp: false, other: false },
      'NOT-004': { email: false, telegram: false, whatsapp: false, other: false },
    },
  });
  const not003 = saved.events.find((row) => row.id === 'NOT-003');
  const not004 = saved.events.find((row) => row.id === 'NOT-004');
  const not008 = saved.events.find((row) => row.id === 'NOT-008');
  const not010 = saved.events.find((row) => row.id === 'NOT-010');
  assert.equal(not003.email, true);
  assert.equal(not003.telegram, false);
  assert.equal(not003.whatsapp, false);
  assert.equal(not004.email, false);
  assert.equal(not004.telegram, false);
  assert.equal(not004.whatsapp, false);
  assert.equal(not004.other, false);
  assert.equal(not008.email, false);
  assert.equal(not010.whatsapp, false);

  const transport = capture();
  const res = fakeRes();
  await vendorUpdate({
    tenantId: tenant._id,
    skipTenantFilter: false,
    params: { orderId: order.orderNo, subOrderId: order.subOrders[0].id },
    body: { action: 'dispatch', trackingNumber: 'AWB-D1', courier: 'Delhivery' },
    notifyDeps: transport.deps,
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(transport.mails.length, 1);
  assert.equal(transport.mails[0].to, COMPANY_MAIL);
  assert.equal(transport.telegrams.length, 0);
  assert.equal(transport.whatsapps.length, 0);
  assert.equal(transport.mails[0].to === CUSTOMER_MAIL, false);

  const shipped = await applyTracking(tenant._id, {
    orderNo: order.orderNo,
    awb: 'AWB-D1',
    status: 'in_transit',
    detail: 'In transit',
    eventKey: 'evt-d1-transit',
  }, transport.deps);
  assert.equal(shipped.duplicate, false);
  assert.equal(transport.mails.length, 1);
  assert.equal(transport.telegrams.length, 0);
  assert.equal(transport.whatsapps.length, 0);
  assert.equal(await NotificationDelivery.countDocuments({ tenantId: tenant._id, eventKey: 'NOT-004' }).setOptions({ skipTenantFilter: true }), 0);
  assert.equal(await NotificationDelivery.countDocuments({ tenantId: tenant._id, eventKey: 'NOT-003', channel: 'email' }).setOptions({ skipTenantFilter: true }), 1);
});

test('NOT-009 goes to the owner, the vendor group stays separate, and a retry does not send again', async () => {
  const tenant = await Tenant.create({
    name: 'Assign shop',
    slug: `assign-${Date.now()}`,
    kind: 'merchant',
    legalEntity: { email: COMPANY_MAIL },
  });
  await Vendor.create({
    tenantId: tenant._id,
    name: 'Raj Prints',
    nameNorm: 'raj prints',
    phone: '919111111111',
    email: 'raj@vendor.test',
    telegramGroup: VENDOR_CHAT,
  });
  await saveNotificationSettings(tenant._id, {
    botToken: BOT,
    ownerChatId: OWNER_CHAT,
    gmailUser: COMPANY_MAIL,
    gmailAppPassword: GMAIL_PASS,
    events: { 'NOT-002': { telegram: true, email: false, whatsapp: false, other: false } },
  });
  const order = await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-A1',
    source: 'manual',
    customer: 'Buyer',
    email: CUSTOMER_MAIL,
    phone: CUSTOMER_PHONE,
    subOrders: [{ id: 'SHP-A1-1', index: 1, sku: 'K1', qty: 1, assignedVendor: 'Raj Prints' }],
  });
  const transport = capture();
  const first = await notifyVendorAssigned(tenant._id, order, order.subOrders[0], transport.deps);
  const second = await notifyVendorAssigned(tenant._id, order, order.subOrders[0], transport.deps);
  assert.equal(first.telegram, 'sent');
  assert.equal(first.ownerTelegram, 'sent');
  assert.equal(second.telegram, 'already_sent');
  assert.equal(second.ownerTelegram, 'already_sent');
  assert.equal(transport.telegrams.filter((row) => row.chatId === VENDOR_CHAT).length, 1);
  assert.equal(transport.telegrams.filter((row) => row.chatId === OWNER_CHAT).length, 1);
  assert.equal(transport.telegrams.length, 2);
  assert.equal(transport.mails.filter((row) => row.to === COMPANY_MAIL).length, 1);
  assert.equal(transport.mails.some((row) => row.to === CUSTOMER_MAIL || row.to === 'raj@vendor.test'), false);

  const vendorRows = await NotificationDelivery.find({ tenantId: tenant._id, eventKey: 'NOT-002', channel: 'telegram' }).setOptions({ skipTenantFilter: true });
  const ownerRows = await NotificationDelivery.find({ tenantId: tenant._id, eventKey: 'NOT-009', channel: 'telegram' }).setOptions({ skipTenantFilter: true });
  assert.equal(vendorRows.length, 1);
  assert.equal(ownerRows.length, 1);
});

test('NOT-010 off sends nothing, and on WhatsApp tells the vendor to dispatch urgently', async () => {
  const tenant = await Tenant.create({
    name: 'Late shop',
    slug: `late-${Date.now()}`,
    kind: 'merchant',
  });
  await saveNotificationSettings(tenant._id, {
    whatsappPhoneNumberId: '555',
    whatsappToken: WA_TOKEN,
    whatsappTo: COMPANY_WA,
    events: { 'NOT-010': { email: false, telegram: false, whatsapp: false, other: false } },
  });
  await Vendor.create({ tenantId: tenant._id, name: 'Raj Prints', nameNorm: 'raj prints', phone: '+91 91111 11111' });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-LATE',
    source: 'manual',
    email: CUSTOMER_MAIL,
    phone: CUSTOMER_PHONE,
    subOrders: [
      { id: 'LATE-1', index: 1, sku: 'K1', qty: 1, assignedVendor: 'Raj Prints', assignedDate: daysAgo(8), vendorStatus: 'Accepted' },
      { id: 'LATE-2', index: 2, sku: 'K2', qty: 1, assignedVendor: 'Raj Prints', assignedDate: daysAgo(1), vendorStatus: 'Accepted' },
    ],
  });
  const transport = capture();
  transport.deps.force = true;
  const quiet = await scanOverdueDispatches(transport.deps);
  assert.equal(quiet, 0);
  assert.equal(transport.whatsapps.length, 0);
  assert.equal(transport.mails.length, 0);
  assert.equal(transport.telegrams.length, 0);

  await saveNotificationSettings(tenant._id, {
    events: { 'NOT-010': { email: false, telegram: false, whatsapp: true, other: false } },
  });
  const sent = await scanOverdueDispatches(transport.deps);
  assert.equal(sent, 1);
  assert.equal(transport.whatsapps.length, 1);
  assert.equal(transport.whatsapps[0].to, '919111111111');
  assert.match(transport.whatsapps[0].text, /Please dispatch this item urgently/);
  assert.equal(transport.whatsapps[0].to === COMPANY_WA, false);
  assert.equal(transport.whatsapps[0].to === CUSTOMER_PHONE, false);
  assert.equal(transport.mails.length, 0);
  assert.equal(transport.telegrams.length, 0);

  const again = await scanOverdueDispatches(transport.deps);
  assert.equal(again, 0);
  assert.equal(transport.whatsapps.length, 1);
});

test('NOT-008 job failure is shown to the company and never sent to the customer', async () => {
  const tenant = await Tenant.create({
    name: 'Jobs shop',
    slug: `jobs-${Date.now()}`,
    kind: 'merchant',
    legalEntity: { email: 'legal@company.test' },
  });
  await saveNotificationSettings(tenant._id, {
    ownerChatId: OWNER_CHAT,
    botToken: BOT,
    gmailUser: COMPANY_MAIL,
    gmailAppPassword: GMAIL_PASS,
    whatsappPhoneNumberId: '555',
    whatsappToken: WA_TOKEN,
    whatsappTo: COMPANY_WA,
    events: { 'NOT-008': { email: true, telegram: true, whatsapp: true, other: true } },
  });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-JOB',
    source: 'manual',
    customer: 'Buyer',
    email: CUSTOMER_MAIL,
    phone: CUSTOMER_PHONE,
  });
  const transport = capture();
  const note = await notifyEventEmail(tenant._id, 'NOT-008', {
    dedupeKey: 'job.failed:job-1',
    subject: 'Job failed orders_pull',
    text: 'Job: orders_pull\nfailed',
  }, transport.deps);
  assert.equal(note.email, 'sent');
  assert.equal(note.telegram, 'sent');
  assert.equal(note.whatsapp, 'sent');
  assert.equal(note.inApp, 'sent');
  assert.equal(transport.mails.length, 1);
  assert.equal(transport.mails[0].to, COMPANY_MAIL);
  assert.equal(transport.telegrams[0].chatId, OWNER_CHAT);
  assert.equal(transport.whatsapps[0].to, COMPANY_WA);
  assert.equal(transport.mails.some((row) => row.to === CUSTOMER_MAIL), false);
  assert.equal(transport.whatsapps.some((row) => row.to === CUSTOMER_PHONE), false);
  const shown = await recentAlerts(tenant._id);
  assert.equal(shown.some((row) => row.eventKey === 'NOT-008' && row.channel === 'in_app' && row.status === 'sent'), true);
  assert.equal(JSON.stringify(shown).includes(CUSTOMER_MAIL), false);
  assert.equal(JSON.stringify(shown).includes(CUSTOMER_PHONE), false);

  const again = await notifyEventEmail(tenant._id, 'NOT-008', {
    dedupeKey: 'job.failed:job-1',
    subject: 'Job failed orders_pull',
    text: 'Job: orders_pull\nfailed',
  }, transport.deps);
  assert.equal(again.email, 'already_sent');
  assert.equal(transport.mails.length, 1);
});

test('saved bot token, Gmail password and WhatsApp token are not returned and a blank save keeps them', async () => {
  const tenant = await Tenant.create({
    name: 'Secret shop',
    slug: `secret-${Date.now()}`,
    kind: 'merchant',
  });
  const req = {
    tenantId: tenant._id,
    user: { id: null, role: 'super_admin' },
    headers: {},
    body: {
      botToken: BOT,
      ownerChatId: OWNER_CHAT,
      gmailUser: COMPANY_MAIL,
      gmailAppPassword: GMAIL_PASS,
      whatsappPhoneNumberId: '555',
      whatsappToken: WA_TOKEN,
      whatsappTo: COMPANY_WA,
      events: { 'NOT-003': { email: true, telegram: false, whatsapp: false, other: false } },
    },
  };
  const saved = fakeRes();
  await notifications.patchNotifications(req, saved);
  const body = JSON.stringify(saved.body);
  assert.equal(body.includes(BOT), false);
  assert.equal(body.includes(GMAIL_PASS), false);
  assert.equal(body.includes(WA_TOKEN), false);
  assert.equal(body.includes('botTokenEnc'), false);
  assert.equal(body.includes('gmailAppPasswordEnc'), false);
  assert.equal(body.includes('tokenEnc'), false);
  assert.equal(saved.body.data.botConfigured, true);
  assert.equal(saved.body.data.mailConfigured, true);
  assert.equal(saved.body.data.whatsappConfigured, true);
  assert.equal(saved.body.data.events.find((row) => row.id === 'NOT-004').email, false);

  const company = fakeRes();
  await settings.patchCompany({
    ...req,
    body: { gmailUser: COMPANY_MAIL, gmailAppPassword: GMAIL_PASS },
  }, company);
  const companyBody = JSON.stringify(company.body);
  assert.equal(companyBody.includes(GMAIL_PASS), false);
  assert.equal(company.body.data.gmailAppPassword, undefined);
  assert.equal(company.body.data.mailConfigured, true);

  const kept = fakeRes();
  await notifications.patchNotifications({
    ...req,
    body: {
      botToken: '',
      gmailAppPassword: '',
      whatsappToken: '',
      gmailUser: COMPANY_MAIL,
      whatsappPhoneNumberId: '555',
      whatsappTo: COMPANY_WA,
      ownerChatId: OWNER_CHAT,
    },
  }, kept);
  const keptBody = JSON.stringify(kept.body);
  assert.equal(keptBody.includes(BOT), false);
  assert.equal(keptBody.includes(GMAIL_PASS), false);
  assert.equal(keptBody.includes(WA_TOKEN), false);
  assert.equal(kept.body.data.botConfigured, true);
  assert.equal(kept.body.data.mailConfigured, true);
  assert.equal(kept.body.data.whatsappConfigured, true);

  const fresh = await loadTenant(tenant._id);
  assert.equal(decryptObject(fresh.settings.notifications.botTokenEnc).token, BOT);
  assert.equal(decryptObject(fresh.settings.mail.gmailAppPasswordEnc).pass, GMAIL_PASS);
  assert.equal(decryptObject(fresh.settings.notifications.whatsapp.tokenEnc).token, WA_TOKEN);

  const loaded = fakeRes();
  await notifications.getNotifications({ tenantId: tenant._id, headers: {} }, loaded);
  const loadedBody = JSON.stringify(loaded.body);
  assert.equal(loadedBody.includes(BOT), false);
  assert.equal(loadedBody.includes(GMAIL_PASS), false);
  assert.equal(loadedBody.includes(WA_TOKEN), false);
});
