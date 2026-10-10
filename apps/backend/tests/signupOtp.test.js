process.env.NODE_ENV = 'test';
process.env.GMAIL_USER = 'platform@example.com';
process.env.GMAIL_APP_PASSWORD = 'platform-pass';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const { encryptObject } = require('../src/lib/secretBox');
const { register, verifyEmail, login, verifyLogin, forgotPassword, startTwoFactor, confirmTwoFactor } = require('../src/controllers/auth.controller');

let memory;
const sent = [];
const originalTransport = nodemailer.createTransport;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    cookie() { return this; },
  };
}

function otpFrom(message) {
  const match = String(message.text || '').match(/\b(\d{6})\b/);
  assert.ok(match, 'mail should contain a 6-digit OTP');
  return match[1];
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  nodemailer.createTransport = () => ({
    sendMail: async (message) => {
      sent.push(message);
      return { messageId: `m-${sent.length}` };
    },
  });
});

test.after(async () => {
  nodemailer.createTransport = originalTransport;
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('a new seller stays signed out until the signup OTP matches', async () => {
  sent.length = 0;
  const email = `seller-${Date.now()}@example.com`;
  const company = `OTP Shop ${Date.now()}`;
  const res = fakeRes();
  await register({
    body: { name: 'New Seller', email, company, password: 'Password1', plan: 'growth' },
    headers: {},
    ip: '127.0.0.1',
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.verificationRequired, true);
  assert.equal(res.body.data.accessToken, undefined);
  assert.equal(sent.length, 1);
  assert.match(sent[0].from, /platform@example.com/);
  const owner = await User.findOne({ email }).setOptions({ skipTenantFilter: true });
  assert.equal(owner.emailVerified, false);

  await assert.rejects(
    () => login({ body: { email, password: 'Password1' }, headers: {}, ip: '127.0.0.1' }, fakeRes()),
    (err) => err.statusCode === 403 && err.data.verificationRequired === true,
  );

  const bad = fakeRes();
  await assert.rejects(
    () => verifyEmail({ body: { email, otp: '000000' }, headers: {}, ip: '127.0.0.1' }, bad),
    (err) => err.statusCode === 400,
  );
  const still = await User.findOne({ email }).setOptions({ skipTenantFilter: true });
  assert.equal(still.emailVerified, false);

  const ok = fakeRes();
  await verifyEmail({ body: { email, otp: otpFrom(sent[0]) }, headers: {}, ip: '127.0.0.1' }, ok);
  assert.ok(ok.body.data.accessToken);
  assert.equal(ok.body.data.user.email, email);
  const verified = await User.findOne({ email }).setOptions({ skipTenantFilter: true });
  assert.equal(verified.emailVerified, true);
  assert.match(sent.at(-1).subject, /Welcome to OMSKing/);

  await assert.rejects(
    () => register({
      body: { name: 'New Seller', email, company, password: 'Password1', plan: 'growth' },
      headers: {},
      ip: '127.0.0.1',
    }, fakeRes()),
    (err) => err.statusCode === 409,
  );

  const reset = fakeRes();
  await forgotPassword({ body: { email }, headers: {} }, reset);
  assert.match(sent.at(-1).from, /platform@example.com/);
  const tenant = await Tenant.findById(verified.tenantId);
  tenant.settings = { mail: { gmailUser: 'shop@example.com', gmailAppPasswordEnc: encryptObject({ pass: 'shop-pass' }) } };
  tenant.markModified('settings');
  await tenant.save();
  await forgotPassword({ body: { email }, headers: {} }, fakeRes());
  assert.match(sent.at(-1).from, /shop@example.com/);
  assert.equal(String(sent.at(-1).from).includes('platform@example.com'), false);

  await startTwoFactor({ user: { id: String(verified._id) }, body: {} }, fakeRes());
  assert.match(sent.at(-1).from, /shop@example.com/);
  const turnedOn = fakeRes();
  await confirmTwoFactor({ user: { id: String(verified._id) }, body: { otp: otpFrom(sent.at(-1)) } }, turnedOn);
  assert.equal(turnedOn.body.data.twoFactorEnabled, true);

  const challenge = fakeRes();
  await login({ body: { email, password: 'Password1' }, headers: {}, ip: '127.0.0.1' }, challenge);
  assert.equal(challenge.body.data.twoFactorRequired, true);
  assert.equal(challenge.body.data.accessToken, undefined);
  const signedIn = fakeRes();
  await verifyLogin({
    body: { email, password: 'Password1', otp: otpFrom(sent.at(-1)) },
    headers: {},
    ip: '127.0.0.1',
  }, signedIn);
  assert.ok(signedIn.body.data.accessToken);
});
