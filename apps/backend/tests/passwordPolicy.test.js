process.env.NODE_ENV = 'test';
process.env.GMAIL_USER = 'platform@example.com';
process.env.GMAIL_APP_PASSWORD = 'platform-pass';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const { MongoMemoryServer } = require('mongodb-memory-server');
const config = require('../src/config');
const Tenant = require('../src/models/Tenant');
const Role = require('../src/models/Role');
const User = require('../src/models/User');
const { hashPassword, passwordProblem, passwordExpired, PASSWORD_MAX_AGE_DAYS } = require('../src/lib/password');
const { passwordRules } = require('../src/middleware/passwordRules');
const { login, verifyLogin, patchMe, forgotPassword, resetPassword } = require('../src/controllers/auth.controller');

let memory;
const sent = [];
const originalTransport = nodemailer.createTransport;
const originalRequire = config.auth?.requireLoginOtp;
const STRONG = 'Strong-Pass12';
const DAY = 24 * 60 * 60 * 1000;

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

async function rulesErrors(password) {
  const req = { body: { password } };
  for (const rule of passwordRules()) await rule.run(req);
  return validationResult(req).array().map((row) => row.msg);
}

async function makeUser(email, extra = {}) {
  const tenant = await Tenant.create({ name: `Shop ${email}`, slug: `shop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'merchant', status: 'active' });
  const role = await Role.create({ tenantId: tenant._id, name: 'Super Admin', code: 'super_admin', permissions: ['*'] });
  return User.create({
    tenantId: tenant._id,
    fullName: 'Asha',
    email,
    passwordHash: await hashPassword(STRONG),
    roleId: role._id,
    ...extra,
  });
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
  config.auth = { ...(config.auth || {}), requireLoginOtp: true };
});

test.after(async () => {
  nodemailer.createTransport = originalTransport;
  config.auth = { ...(config.auth || {}), requireLoginOtp: originalRequire };
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('new passwords need 12 characters with upper, lower, number and a special character', async () => {
  assert.ok((await rulesErrors('Password123')).some((msg) => /12 characters/.test(msg)));
  assert.ok((await rulesErrors('Password1234')).some((msg) => /special character/.test(msg)));
  assert.deepEqual(await rulesErrors(STRONG), []);
  assert.match(passwordProblem('Short-1a'), /12 characters/);
  assert.match(passwordProblem('Password1234'), /special character/);
  assert.equal(passwordProblem(STRONG), '');
});

test('every account must enter the email OTP at sign-in, even with OTP not turned on', async () => {
  sent.length = 0;
  const email = `otp-${Date.now()}@example.com`;
  await makeUser(email, { twoFactorEnabled: false });
  const challenge = fakeRes();
  await login({ body: { email, password: STRONG }, headers: {}, ip: '127.0.0.1' }, challenge);
  assert.equal(challenge.body.data.twoFactorRequired, true);
  assert.equal(challenge.body.data.accessToken, undefined);
  assert.equal(sent.length, 1);

  const signedIn = fakeRes();
  await verifyLogin({ body: { email, password: STRONG, otp: otpFrom(sent.at(-1)) }, headers: {}, ip: '127.0.0.1' }, signedIn);
  assert.ok(signedIn.body.data.accessToken);
  assert.equal(signedIn.body.data.user.twoFactorRequired, true);
});

test('sign-in OTP cannot be turned off while it is required', async () => {
  const user = await makeUser(`off-${Date.now()}@example.com`, { twoFactorEnabled: true });
  await assert.rejects(
    () => patchMe({ user: { id: String(user._id) }, body: { twoFactorEnabled: false }, headers: {} }, fakeRes()),
    (err) => err.statusCode === 400 && /required for every account/.test(err.message),
  );
  const still = await User.findById(user._id).setOptions({ skipTenantFilter: true });
  assert.equal(still.twoFactorEnabled, true);
});

test('a password older than 365 days must be reset before sign-in; the reset starts a new year', async () => {
  sent.length = 0;
  const email = `old-${Date.now()}@example.com`;
  const user = await makeUser(email);
  assert.ok(user.passwordChangedAt instanceof Date, 'saving a password hash records when it changed');
  await User.updateOne({ _id: user._id }, { passwordChangedAt: new Date(Date.now() - (PASSWORD_MAX_AGE_DAYS + 1) * DAY) }).setOptions({ skipTenantFilter: true });
  assert.equal(passwordExpired({ passwordChangedAt: new Date(Date.now() - 10 * DAY) }), false);
  assert.equal(passwordExpired({ createdAt: new Date(Date.now() - 400 * DAY) }), true);

  await assert.rejects(
    () => login({ body: { email, password: STRONG }, headers: {}, ip: '127.0.0.1' }, fakeRes()),
    (err) => err.statusCode === 403 && err.data?.passwordExpired === true && /365 days/.test(err.message),
  );
  assert.equal(sent.length, 0, 'no sign-in OTP is sent for an expired password');

  await forgotPassword({ body: { email }, headers: {} }, fakeRes());
  const next = 'Fresh-Pass-2026';
  await resetPassword({ body: { email, otp: otpFrom(sent.at(-1)), password: next }, headers: {} }, fakeRes());
  const fresh = await User.findById(user._id).setOptions({ skipTenantFilter: true });
  assert.ok(Date.now() - fresh.passwordChangedAt.getTime() < 60 * 1000);

  const challenge = fakeRes();
  await login({ body: { email, password: next }, headers: {}, ip: '127.0.0.1' }, challenge);
  assert.equal(challenge.body.data.twoFactorRequired, true);
});
