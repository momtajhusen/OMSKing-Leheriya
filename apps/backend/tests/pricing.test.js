process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');
const { ensurePricing, quoteOrders, savePricing, paymentPublic, upiPayUrl } = require('../src/services/pricing.service');
const { subscriptionMessage, recordSubscriptionPayment, expiredTrialMessage, mySubscription, upiCheckout, submitUpiReference, confirmRazorpayCheckout, applyRazorpayWebhook } = require('../src/services/subscription.service');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { createInquiry } = require('../src/controllers/pricing.controller');
const PricingInquiry = require('../src/models/PricingInquiry');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('a quiet month still meets the minimum and a large month uses the lowest per-order rate', async () => {
  const doc = await ensurePricing();
  const quiet = quoteOrders(100, doc);
  assert.equal(quiet.rate, 2);
  assert.equal(quiet.usage, 200);
  assert.equal(quiet.bill, 1000);
  assert.equal(quiet.adjustment, 800);

  const busy = quoteOrders(25000, doc);
  assert.equal(busy.rate, 0.75);
  assert.equal(busy.bill, 18750);
  assert.equal(busy.adjustment, 0);

  const saved = await savePricing({
    minimumMonthly: 500,
    slabs: [
      { upTo: 100, rate: 3 },
      { upTo: null, rate: 1 },
    ],
  });
  assert.equal(quoteOrders(10, saved).bill, 500);
  assert.equal(quoteOrders(200, saved).rate, 1);
  assert.equal(quoteOrders(200, saved).usage, 200);
  assert.equal(quoteOrders(200, saved).bill, 500);
  assert.equal(quoteOrders(600, saved).bill, 600);
});

test('a pricing request is stored in the database', async () => {
  const email = `price-${Date.now()}@example.com`;
  const created = await new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    createInquiry({ body: { name: 'Price Buyer', email, company: 'Rate Check', orders: '4000' } }, res).catch(reject);
  });
  assert.equal(created.status, 201);
  const row = await PricingInquiry.findOne({ email });
  assert.equal(row.company, 'Rate Check');
  assert.equal(row.orders, '4000');
});

test('a company sees the payment instructions, and marking the month paid opens a trial', async () => {
  const doc = await savePricing({
    minimumMonthly: 1000,
    slabs: [{ upTo: null, rate: 2 }],
    payment: { upiId: 'omsking@upi', accountName: 'OMSKing', note: 'Share the UPI reference.' },
  });
  assert.equal(paymentPublic(doc).upiId, 'omsking@upi');
  const message = subscriptionMessage({
    status: 'trial',
    plan: 'growth',
    planExpiresAt: new Date(Date.now() + 2 * 86400000),
    orders: 4,
    bill: 1000,
    payment: paymentPublic(doc),
    paid: null,
  });
  assert.match(message, /UPI omsking@upi/);
  assert.match(message, /Growth trial/);
  assert.match(message, /Share the UPI reference/);

  const { tenant } = await provisionMerchant({
    name: `Bill Shop ${Date.now()}`,
    ownerEmail: `bill-${Date.now()}@example.com`,
    ownerName: 'Bill',
    password: 'Password1',
    status: 'trial',
    plan: 'starter',
  });
  const view = await recordSubscriptionPayment(tenant._id, { amount: 1000, note: 'UPI ref 1' });
  assert.equal(view.monthStatus, 'paid');
  assert.equal(view.status, 'active');
  assert.match(view.message, /is paid/);

  const mine = await mySubscription(tenant);
  assert.ok(mine.slabs.length >= 1);
  assert.equal(mine.history.length, 1);
  assert.equal(mine.history[0].note, 'UPI ref 1');
  assert.equal(mine.usage, 0);
  assert.equal(mine.bill, 1000);
  assert.ok(mine.periodLabel);
  assert.ok(Array.isArray(mine.lines));
  assert.equal(mine.cancelled, 0);
  assert.match(mine.billNo, /^SUB-/);

  const ended = await expiredTrialMessage({ _id: tenant._id, plan: 'starter', planExpiresAt: new Date('2020-01-01') });
  assert.match(ended, /This trial ended/);
  assert.match(ended, /UPI omsking@upi/);
});

test('a company can pay the UPI link, and a verified Razorpay payment marks the month paid', async () => {
  const doc = await savePricing({
    minimumMonthly: 1000,
    slabs: [{ upTo: null, rate: 2 }],
    payment: {
      upiId: 'omsking@upi',
      accountName: 'OMSKing',
      razorpayKeyId: 'rzp_test_abc123',
      razorpayKeySecret: 'secret_value',
      razorpayWebhookSecret: 'hook_secret',
    },
  });
  const url = upiPayUrl({ upiId: 'omsking@upi', payeeName: 'OMSKing', amount: 1000, note: 'OMSKing October 2026' });
  assert.match(url, /^upi:\/\/pay\?/);
  assert.match(url, /pa=omsking@upi/);
  assert.match(url, /am=1000\.00/);
  assert.match(url, /cu=INR/);
  assert.equal(paymentPublic(doc).razorpayReady, true);
  assert.equal(JSON.stringify(paymentPublic(doc)).includes('secret_value'), false);
  assert.equal(JSON.stringify(paymentPublic(doc)).includes('hook_secret'), false);

  const { tenant } = await provisionMerchant({
    name: `UPI Shop ${Date.now()}`,
    ownerEmail: `upi-${Date.now()}@example.com`,
    ownerName: 'UPI',
    password: 'Password1',
    status: 'trial',
    plan: 'starter',
  });
  const intent = await upiCheckout(tenant);
  assert.equal(intent.ready, true);
  assert.match(intent.upiUrl, /am=1000\.00/);
  assert.match(intent.qr, /^data:image\/png/);
  const sent = await submitUpiReference(tenant, '123456789012');
  assert.equal(sent.monthStatus, 'submitted');
  assert.equal(sent.status, 'trial');
  assert.match(sent.message, /123456789012/);

  await assert.rejects(
    () => confirmRazorpayCheckout(tenant, { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'nope' }),
    /could not be verified/,
  );

  const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const signature = crypto.createHmac('sha256', 'secret_value').update('order_1|pay_1').digest('hex');
  const paid = await confirmRazorpayCheckout(tenant, {
    razorpay_order_id: 'order_1',
    razorpay_payment_id: 'pay_1',
    razorpay_signature: signature,
  }, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        id: 'pay_1',
        order_id: 'order_1',
        status: 'captured',
        amount: 100000,
        notes: { tenantId: String(tenant._id), period, purpose: 'subscription' },
      }),
    }),
  });
  assert.equal(paid.monthStatus, 'paid');
  assert.equal(paid.status, 'active');

  const { tenant: other } = await provisionMerchant({
    name: `Hook Shop ${Date.now()}`,
    ownerEmail: `hook-${Date.now()}@example.com`,
    ownerName: 'Hook',
    password: 'Password1',
    status: 'trial',
    plan: 'starter',
  });
  const payload = Buffer.from(JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: {
      id: 'pay_hook',
      status: 'captured',
      amount: 100000,
      notes: { tenantId: String(other._id), period, purpose: 'subscription' },
    } } },
  }));
  await assert.rejects(
    () => applyRazorpayWebhook({ rawBody: payload, headers: { 'x-razorpay-signature': 'bad' } }),
    /Invalid Razorpay signature/,
  );
  const hookSig = crypto.createHmac('sha256', 'hook_secret').update(payload).digest('hex');
  const applied = await applyRazorpayWebhook({ rawBody: payload, headers: { 'x-razorpay-signature': hookSig } });
  assert.equal(applied.ignored, false);
  assert.equal(applied.tenantId, String(other._id));
});
