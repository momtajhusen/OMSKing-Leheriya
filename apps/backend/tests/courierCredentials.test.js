process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const { decryptObject } = require('../src/lib/secretBox');
const { createCourier } = require('../src/services/courierAccount.service');
const CourierAccount = require('../src/models/CourierAccount');
const delhivery = require('../src/adapters/couriers/delhivery');

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

test('Delhivery token saves without a pickup warehouse and does not call Delhivery', async () => {
  const row = await tenant();
  const dto = await createCourier(row._id, null, {
    source: 'own',
    code: 'delhivery',
    mode: 'air',
    status: 'active',
    credentials: {
      apiToken: 'token-from-mail',
      clientName: 'PRDOSCO GLOBAL B2C',
      apiVersion: 'V3',
    },
  });
  assert.equal(dto.credentials.apiToken, '');
  assert.equal(dto.credentials.clientName, 'PRDOSCO GLOBAL B2C');
  assert.equal(dto.credentials.apiVersion, 'V3');
  assert.equal(dto.credentials.apiMode || '', '');
  assert.equal(dto.mode, 'air');
  assert.equal(dto.hasSecrets, true);

  const stored = await CourierAccount.findOne({ tenantId: row._id, source: 'own', code: 'delhivery' });
  const creds = decryptObject(stored.credentialsEnc);
  assert.equal(creds.apiToken, 'token-from-mail');
  assert.equal(creds.apiMode || '', '');

  let called = false;
  await assert.rejects(
    () => delhivery.book(creds, {
      name: 'Buyer',
      address: 'Lane 1',
      pincode: '110001',
      city: 'Delhi',
      state: 'Delhi',
      phone: '9999999999',
      orderNo: 'ORD-1',
      paymentMode: 'Prepaid',
      description: 'Kurta',
      quantity: 1,
      amount: 100,
      pickupAddress: 'WH',
    }, { request: () => { called = true; } }),
    /Pickup warehouse|Live API was not called/,
  );
  assert.equal(called, false);
});

test('Bluedart licence keys stay encrypted and the account fields from the mail are kept', async () => {
  const row = await tenant();
  const dto = await createCourier(row._id, null, {
    source: 'own',
    code: 'bluedart',
    mode: 'air',
    credentials: {
      loginId: 'DEL79448',
      licenceKey: 'licence-secret',
      trackingLicenceKey: 'tracking-secret',
      customerCode: '871102',
      customerCodeCod: '871102',
      vendorCode: '871102',
      originArea: 'DEL',
      serviceType: 'Air/Apex',
      accountMode: 'live',
      autoPickup: 'Yes',
      otpDelivery: 'Yes',
      labelType: 'Shipway Label',
    },
  });
  assert.equal(dto.credentials.loginId, 'DEL79448');
  assert.equal(dto.credentials.licenceKey, '');
  assert.equal(dto.credentials.trackingLicenceKey, '');
  assert.equal(dto.credentials.originArea, 'DEL');
  assert.equal(dto.credentials.vendorCode, '871102');
  assert.equal(dto.credentials.customerCode, '871102');
  assert.equal(dto.mode, 'air');
  assert.equal(JSON.stringify(dto).includes('tracking-secret'), false);
  assert.equal(JSON.stringify(dto).includes('licence-secret'), false);

  const stored = await CourierAccount.findOne({ tenantId: row._id, source: 'own', code: 'bluedart' });
  const creds = decryptObject(stored.credentialsEnc);
  assert.equal(creds.trackingLicenceKey, 'tracking-secret');
  assert.equal(creds.licenceKey, 'licence-secret');
});

test('Amazon Shipping sandbox token is stored on the courier account, not as a live seller connection', async () => {
  const row = await tenant();
  const dto = await createCourier(row._id, null, {
    source: 'own',
    code: 'amazon-shipping',
    credentials: {
      clientId: 'amzn1.application-oa2-client.test',
      clientSecret: 'client-secret-value',
      refreshToken: 'Atzr|sandbox-token',
      applicationId: 'amzn1.sp.solution.test',
      applicationName: 'Shipway Amazon',
      apiMode: 'sandbox',
    },
  });
  assert.equal(dto.code, 'amazon-shipping');
  assert.equal(dto.credentials.clientId, 'amzn1.application-oa2-client.test');
  assert.equal(dto.credentials.clientSecret, '');
  assert.equal(dto.credentials.refreshToken, '');
  assert.equal(dto.credentials.apiMode, 'sandbox');
  assert.equal(dto.credentials.applicationId, 'amzn1.sp.solution.test');
  assert.equal(JSON.stringify(dto).includes('client-secret-value'), false);
  assert.equal(JSON.stringify(dto).includes('Atzr|sandbox-token'), false);
});
