process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Order = require('../src/models/Order');
const PlatformSetting = require('../src/models/PlatformSetting');
const { encryptObject } = require('../src/lib/secretBox');
const { ensurePricing } = require('../src/services/pricing.service');
const { mySubscription, upiCheckout, submitUpiReference, recordSubscriptionPayment } = require('../src/services/subscription.service');
const { savePricing } = require('../src/services/pricing.service');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { listTenants } = require('../src/controllers/tenants.controller');
const { forgotPassword, resendVerification } = require('../src/controllers/auth.controller');

let memory;
const originalTransport = nodemailer.createTransport;
const sent = [];

function paise(value) {
  return Math.round(Number(value) * 100);
}

function at(year, monthIndex, day, hour = 12) {
  return new Date(year, monthIndex, day, hour, 0, 0, 0);
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  nodemailer.createTransport = (opts) => {
    const auth = { user: opts.auth.user, pass: opts.auth.pass };
    return {
      sendMail: async (message) => {
        sent.push({ auth, from: message.from, to: message.to });
        return { messageId: `m-${sent.length}` };
      },
    };
  };
});

test.after(async () => {
  nodemailer.createTransport = originalTransport;
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('October bill counts 126 orders, leaves cancelled out, and applies the minimum', async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const placed = at(year, month, 15);
  const savedLater = at(year, month + 1, 3);
  const placedEarlier = at(year, month - 1, 20);
  const { tenant } = await provisionMerchant({
    name: `October Shop ${Date.now()}`,
    ownerEmail: `october-${Date.now()}@example.com`,
    ownerName: 'October',
    password: 'Password1',
    status: 'active',
    plan: 'growth',
  });
  const { tenant: other } = await provisionMerchant({
    name: `Other Shop ${Date.now()}`,
    ownerEmail: `other-bill-${Date.now()}@example.com`,
    ownerName: 'Other',
    password: 'Password1',
    status: 'active',
    plan: 'growth',
  });

  const rows = [];
  for (let i = 0; i < 100; i += 1) {
    rows.push({
      tenantId: tenant._id,
      orderNo: `OCT-S-${i}`,
      channel: 'Shopify',
      status: 'Delivered',
      orderDate: placed,
      createdAt: savedLater,
      updatedAt: savedLater,
    });
  }
  for (let i = 0; i < 26; i += 1) {
    rows.push({
      tenantId: tenant._id,
      orderNo: `OCT-A-${i}`,
      channel: 'Amazon',
      status: 'New',
      orderDate: placed,
      createdAt: placed,
      updatedAt: placed,
    });
  }
  for (let i = 0; i < 8; i += 1) {
    rows.push({
      tenantId: tenant._id,
      orderNo: `OCT-C-${i}`,
      channel: 'Myntra',
      status: 'Cancelled',
      orderDate: placed,
      createdAt: placed,
      updatedAt: placed,
    });
  }
  for (let i = 0; i < 15; i += 1) {
    rows.push({
      tenantId: tenant._id,
      orderNo: `SEP-${i}`,
      channel: 'Shopify',
      status: 'Delivered',
      orderDate: placedEarlier,
      createdAt: placed,
      updatedAt: placed,
    });
  }
  for (let i = 0; i < 40; i += 1) {
    rows.push({
      tenantId: other._id,
      orderNo: `OTHER-${i}`,
      channel: 'Shopify',
      status: 'New',
      orderDate: placed,
      createdAt: placed,
      updatedAt: placed,
    });
  }
  await Order.insertMany(rows);
  await ensurePricing();

  const view = await mySubscription(tenant);
  assert.equal(view.orders, 126);
  assert.equal(view.cancelled, 8);
  assert.equal(view.rate, 2);
  assert.equal(view.usage, 252);
  assert.equal(view.minimumMonthly, 1000);
  assert.equal(view.adjustment, 748);
  assert.equal(view.bill, 1000);
  assert.equal(view.period, `${year}-${String(month + 1).padStart(2, '0')}`);
  assert.equal(paise(view.usage) + paise(view.adjustment), paise(view.bill));
  [view.bill, view.usage, view.adjustment, view.rate, view.minimumMonthly].forEach((amount) => {
    assert.equal(paise(amount) / 100, amount);
  });
  const billed = view.lines.reduce((sum, line) => sum + line.orders, 0);
  const linePaise = view.lines.reduce((sum, line) => sum + paise(line.amount), 0);
  assert.equal(billed, 126);
  assert.equal(linePaise, paise(view.usage));
  const shopify = view.lines.find((line) => line.channel === 'Shopify');
  assert.equal(shopify.orders, 100);
  assert.equal(shopify.cancelled, 0);

  const listed = await new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve(payload); },
    };
    listTenants({}, res).catch(reject);
  });
  const row = listed.data.find((item) => item.id === String(tenant._id));
  assert.equal(row.ordersThisMonth, 126);
  assert.equal(row.mrr, 1000);
  const foreign = listed.data.find((item) => item.id === String(other._id));
  assert.equal(foreign.ordersThisMonth, 40);
});

test('I have paid stays off without a UPI id, and Paid appears only after Platform records it', async () => {
  await savePricing({
    minimumMonthly: 1000,
    slabs: [
      { upTo: 1000, rate: 2 },
      { upTo: 5000, rate: 1.5 },
      { upTo: 20000, rate: 1 },
      { upTo: null, rate: 0.75 },
    ],
    payment: { upiId: '', accountName: '', note: '' },
  });
  const { tenant } = await provisionMerchant({
    name: `UPI Wait ${Date.now()}`,
    ownerEmail: `upi-wait-${Date.now()}@example.com`,
    ownerName: 'UPI',
    password: 'Password1',
    status: 'active',
    plan: 'starter',
  });
  const closed = await upiCheckout(tenant);
  assert.equal(closed.ready, false);
  assert.equal(closed.upiId || '', '');
  await assert.rejects(() => submitUpiReference(tenant, 'ABC123456'), /UPI is not configured yet/);

  await savePricing({
    minimumMonthly: 1000,
    slabs: [{ upTo: null, rate: 2 }],
    payment: { upiId: 'omsking@upi', accountName: 'OMSKing', note: 'Share the reference.' },
  });
  const open = await upiCheckout(tenant);
  assert.equal(open.upiId, 'omsking@upi');
  const sentRef = await submitUpiReference(tenant, 'ABC123456');
  assert.equal(sentRef.monthStatus, 'submitted');
  assert.notEqual(sentRef.monthStatus, 'paid');
  const waiting = await mySubscription(tenant);
  assert.equal(waiting.monthStatus, 'submitted');
  assert.match(waiting.message, /shows Paid after they confirm/);

  const paid = await recordSubscriptionPayment(tenant._id, { note: 'ABC123456' });
  assert.equal(paid.monthStatus, 'paid');
  assert.equal(paid.bill, 1000);
  assert.equal(paise(paid.bill), 100000);
});

test('signup and forgot-password OTP use that company Gmail and not another company', async () => {
  sent.length = 0;
  await PlatformSetting.create({
    key: 'default',
    gmailUser: 'panel@example.com',
    gmailAppPasswordEnc: encryptObject({ pass: 'panel-pass' }),
  });
  const stamp = Date.now();
  const a = await provisionMerchant({
    name: `Mail A ${stamp}`,
    ownerEmail: `owner-a-${stamp}@example.com`,
    ownerName: 'Owner A',
    password: 'Password1',
    status: 'active',
    emailVerified: false,
  });
  const b = await provisionMerchant({
    name: `Mail B ${stamp}`,
    ownerEmail: `owner-b-${stamp}@example.com`,
    ownerName: 'Owner B',
    password: 'Password1',
    status: 'active',
    emailVerified: false,
  });
  const bare = await provisionMerchant({
    name: `Mail Bare ${stamp}`,
    ownerEmail: `owner-bare-${stamp}@example.com`,
    ownerName: 'Owner Bare',
    password: 'Password1',
    status: 'active',
    emailVerified: false,
  });
  a.tenant.settings.mail = {
    gmailUser: 'shop-a@example.com',
    gmailAppPasswordEnc: encryptObject({ pass: 'app-pass-a' }),
  };
  b.tenant.settings.mail = {
    gmailUser: 'shop-b@example.com',
    gmailAppPasswordEnc: encryptObject({ pass: 'app-pass-b' }),
  };
  a.tenant.markModified('settings');
  b.tenant.markModified('settings');
  await a.tenant.save();
  await b.tenant.save();

  await resendVerification({ body: { email: a.owner.email }, headers: {} }, fakeRes());
  await forgotPassword({ body: { email: a.owner.email }, headers: {} }, fakeRes());
  await forgotPassword({ body: { email: b.owner.email }, headers: {} }, fakeRes());
  await forgotPassword({ body: { email: bare.owner.email }, headers: {} }, fakeRes());

  assert.equal(sent.length, 4);
  assert.equal(sent[0].auth.user, 'shop-a@example.com');
  assert.equal(sent[0].auth.pass, 'app-pass-a');
  assert.match(sent[0].from, /shop-a@example.com/);
  assert.equal(sent[1].auth.user, 'shop-a@example.com');
  assert.equal(sent[1].auth.pass, 'app-pass-a');
  assert.match(sent[1].from, /shop-a@example.com/);
  assert.equal(sent[2].auth.user, 'shop-b@example.com');
  assert.equal(sent[2].auth.pass, 'app-pass-b');
  assert.match(sent[2].from, /shop-b@example.com/);
  assert.equal(sent[3].auth.user, 'panel@example.com');
  assert.equal(sent[3].auth.pass, 'panel-pass');
  assert.equal(String(sent[3].from).includes('shop-b@example.com'), false);
  sent.forEach((row) => {
    const foreign = row.auth.user === 'shop-a@example.com' ? 'app-pass-b' : 'app-pass-a';
    if (row.auth.user.startsWith('shop-')) assert.equal(row.auth.pass === foreign, false);
  });
  assert.equal(sent[0].auth === sent[2].auth, false);
});
