process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const CourierAccount = require('../src/models/CourierAccount');
const { encryptObject } = require('../src/lib/secretBox');
const { mailboxOf } = require('../src/lib/mailer');
const { activeCourierCreds } = require('../src/services/courierAccount.service');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { login } = require('../src/controllers/auth.controller');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

function callLogin(body) {
  return new Promise((resolve, reject) => {
    const req = { body, ip: '127.0.0.1', headers: {} };
    const res = {
      statusCode: 200,
      cookie() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    login(req, res).catch(reject);
  });
}

test('one company mailbox is not used for another company', async () => {
  const a = await Tenant.create({
    name: 'Leheriya',
    slug: `leheriya-${Date.now()}`,
    kind: 'merchant',
    settings: { mail: { gmailUser: 'shop-a@example.com', gmailAppPasswordEnc: encryptObject({ pass: 'app-pass-a' }) } },
  });
  const b = await Tenant.create({
    name: 'Surat Silks',
    slug: `surat-${Date.now()}`,
    kind: 'merchant',
    settings: { mail: { gmailUser: 'shop-b@example.com', gmailAppPasswordEnc: encryptObject({ pass: 'app-pass-b' }) } },
  });
  const bare = await Tenant.create({
    name: 'No mail',
    slug: `nomail-${Date.now()}`,
    kind: 'merchant',
  });
  const boxA = await mailboxOf(a._id);
  const boxB = await mailboxOf(b._id);
  const boxBare = await mailboxOf(bare._id);
  assert.equal(boxA.user, 'shop-a@example.com');
  assert.equal(boxA.pass, 'app-pass-a');
  assert.equal(boxB.user, 'shop-b@example.com');
  assert.equal(boxBare, null);
  assert.equal(JSON.stringify(boxA).includes('app-pass-b'), false);
});

test('Delhivery token stays on the company that saved it', async () => {
  const a = await Tenant.create({ name: 'A', slug: `a-${Date.now()}`, kind: 'merchant' });
  const b = await Tenant.create({ name: 'B', slug: `b-${Date.now()}`, kind: 'merchant' });
  await CourierAccount.create({
    tenantId: a._id,
    source: 'platform',
    code: 'delhivery',
    name: 'Delhivery',
    status: 'active',
  });
  await CourierAccount.create({
    tenantId: a._id,
    source: 'own',
    code: 'delhivery',
    name: 'Delhivery',
    status: 'active',
    credentialsEnc: encryptObject({ apiToken: 'token-a', pickupWarehouse: 'WH-A' }),
  });
  await CourierAccount.create({
    tenantId: b._id,
    source: 'own',
    code: 'delhivery',
    name: 'Delhivery',
    status: 'active',
    credentialsEnc: encryptObject({ apiToken: 'token-b' }),
  });
  const credsA = await activeCourierCreds(a._id, 'delhivery');
  const credsB = await activeCourierCreds(b._id, 'delhivery');
  assert.equal(credsA.apiToken, 'token-a');
  assert.equal(credsB.apiToken, 'token-b');
});

test('the same email on two companies does not sign in as the other Super Admin', async () => {
  const password = 'Password1';
  const email = `owner-${Date.now()}@example.com`;
  const first = await provisionMerchant({
    name: 'Company One',
    ownerEmail: email,
    ownerName: 'Owner One',
    password,
  });
  const second = await provisionMerchant({
    name: 'Company Two',
    ownerEmail: email,
    ownerName: 'Owner Two',
    password: 'Password2',
  });
  const signedIn = await callLogin({ email, password });
  assert.equal(signedIn.body.data.user.tenantId, String(first.tenant._id));
  assert.equal(signedIn.body.data.user.tenantName, 'Company One');
  await assert.rejects(() => callLogin({ email, password, workspace: second.tenant.slug }), /Invalid email or password/);

  const shared = `shared-${Date.now()}@example.com`;
  const left = await provisionMerchant({
    name: 'Shared Left',
    ownerEmail: shared,
    ownerName: 'Left',
    password,
  });
  await provisionMerchant({
    name: 'Shared Right',
    ownerEmail: shared,
    ownerName: 'Right',
    password,
  });
  await assert.rejects(() => callLogin({ email: shared, password }), (err) => {
    assert.match(err.message, /more than one company/);
    assert.equal(err.data.companies.length, 2);
    return true;
  });
  const picked = await callLogin({ email: shared, password, workspace: left.tenant.slug });
  assert.equal(picked.body.data.user.tenantName, 'Shared Left');
});

test('a signup trial stores the chosen plan and blocks sign-in after 14 days', async () => {
  const email = `trial-${Date.now()}@example.com`;
  const created = await provisionMerchant({
    name: 'Trial Shop',
    ownerEmail: email,
    ownerName: 'Trial Owner',
    password: 'Password1',
    status: 'trial',
    plan: 'growth',
    channels: ['Shopify', 'Amazon', 'Myntra'],
  });
  const fresh = await Tenant.findById(created.tenant._id);
  assert.equal(fresh.plan, 'growth');
  assert.equal(fresh.status, 'trial');
  assert.ok(fresh.planExpiresAt > new Date());
  fresh.planExpiresAt = new Date(Date.now() - 60 * 1000);
  await fresh.save();
  await assert.rejects(
    () => callLogin({ email, password: 'Password1', workspace: fresh.slug }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /This trial ended/);
      assert.match(err.message, /bill is ₹1,000/);
      assert.equal(err.accessToken, undefined);
      return true;
    },
  );
});
