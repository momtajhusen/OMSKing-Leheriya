process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const CourierAccount = require('../src/models/CourierAccount');
const { decryptObject } = require('../src/lib/secretBox');
const { findOwn } = require('../src/constants/courierCatalog');
const { createCourier, listCouriers } = require('../src/services/courierAccount.service');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

async function tenant() {
  return Tenant.create({ name: 'Leheriya', slug: `leheriya-${Date.now()}-${Math.random()}`, kind: 'merchant' });
}

const creds = {
  email: 'ops@example.com',
  password: 'test-password',
  apiKey: 'test-api-key',
  userId: 'test-user-id',
  accountTenantId: 'test-account-tenant',
  orderType: 'Forward',
  parcelCategory: 'Ecomm',
};

test('Shree Maruti is a direct courier with the same fields as its Shipway connection', () => {
  const item = findOwn('shree-maruti');
  assert.ok(item, 'shree-maruti missing from own couriers');
  assert.equal(item.name, 'Shree Maruti');
  assert.ok(item.capabilities.includes('forward'));
  const byKey = Object.fromEntries(item.fields.map((field) => [field.key, field]));
  ['email', 'password', 'apiKey', 'userId', 'accountTenantId'].forEach((key) => {
    assert.ok(byKey[key], `${key} field missing`);
    assert.equal(byKey[key].required, true, `${key} should be required`);
  });
  assert.equal(byKey.password.type, 'password');
  assert.equal(byKey.apiKey.type, 'password');
  assert.ok(byKey.orderType);
  assert.ok(byKey.parcelCategory);
});

test('Shree Maruti credentials save encrypted, secrets never come back, other tenants do not see them', async () => {
  const row = await tenant();
  const other = await tenant();
  const dto = await createCourier(row._id, null, { source: 'own', code: 'shree-maruti', credentials: creds });

  assert.equal(dto.code, 'shree-maruti');
  assert.equal(dto.name, 'Shree Maruti');
  assert.equal(dto.hasSecrets, true);
  assert.equal(dto.credentials.password, '');
  assert.equal(dto.credentials.apiKey, '');
  assert.equal(dto.credentials.email, 'ops@example.com');
  assert.equal(dto.credentials.userId, 'test-user-id');
  assert.equal(dto.credentials.accountTenantId, 'test-account-tenant');
  assert.equal(dto.credentials.orderType, 'Forward');
  assert.equal(dto.credentials.parcelCategory, 'Ecomm');

  const stored = await CourierAccount.findOne({ tenantId: row._id, code: 'shree-maruti' }).setOptions({ skipTenantFilter: true });
  assert.ok(!JSON.stringify(stored.credentialsEnc).includes('test-api-key'));
  const saved = decryptObject(stored.credentialsEnc);
  assert.equal(saved.apiKey, 'test-api-key');
  assert.equal(saved.password, 'test-password');

  const mine = await listCouriers(row._id);
  assert.ok(mine.own.some((item) => item.code === 'shree-maruti'));
  assert.equal(mine.accounts.filter((item) => item.code === 'shree-maruti').length, 1);
  const theirs = await listCouriers(other._id);
  assert.equal(theirs.accounts.filter((item) => item.code === 'shree-maruti').length, 0);
});

test('Shree Maruti without the API key is rejected', async () => {
  const row = await tenant();
  const { apiKey, ...rest } = creds;
  await assert.rejects(
    () => createCourier(row._id, null, { source: 'own', code: 'shree-maruti', credentials: rest }),
    (err) => err.status === 400 || err.statusCode === 400,
  );
});
