process.env.NODE_ENV = 'test';
process.env.CHANNEL_ENCRYPTION_KEY = 'shopify-token-test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ensureShopifyCreds } = require('../src/adapters/shopify');
const { keysReady } = require('../src/services/jobQueue.service');
const { upsertConnection, credsOf, toDto } = require('../src/services/channelConnection.service');
const { shopifyCreds } = require('../src/services/shopifyAuth.service');
const Tenant = require('../src/models/Tenant');

const SHOP = 'leheriya-com.myshopify.com';
const CLIENT = '8ca034101ab5d4109fd9fc7775dc7187';
const SECRET = 'shpss_test_secret_value';
const ISSUED = 'shpat_issued_token';

function creds(extra = {}) {
  return {
    shopUrl: `https://${SHOP}`,
    clientId: CLIENT,
    apiSecret: SECRET,
    apiMode: 'live',
    ...extra,
  };
}

function tokenRequest(calls) {
  return async (method, url, opts) => {
    calls.push({ method, url, body: opts.body });
    return { status: 200, text: JSON.stringify({ access_token: ISSUED, expires_in: 86399 }) };
  };
}

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('client credentials issue a token and a later call reuses it until it is near expiry', async () => {
  const calls = [];
  const now = Date.parse('2026-10-11T12:00:00.000Z');
  const first = await ensureShopifyCreds(creds(), { request: tokenRequest(calls), now });
  assert.equal(first.adminToken, ISSUED);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `https://${SHOP}/admin/oauth/access_token`);
  assert.match(calls[0].body, /grant_type=client_credentials/);
  assert.match(calls[0].body, new RegExp(`client_id=${CLIENT}`));
  assert.doesNotMatch(JSON.stringify(first.tokenExpiresAt), /shpss_/);

  const again = await ensureShopifyCreds(first, { request: tokenRequest(calls), now: now + 60 * 1000 });
  assert.equal(again.adminToken, ISSUED);
  assert.equal(calls.length, 1);

  const expired = await ensureShopifyCreds(first, {
    request: tokenRequest(calls),
    now: Date.parse(first.tokenExpiresAt) - 30 * 60 * 1000,
  });
  assert.equal(expired.adminToken, ISSUED);
  assert.equal(calls.length, 2);
});

test('a saved admin token without an expiry is left as it is', async () => {
  const calls = [];
  const next = await ensureShopifyCreds(creds({ adminToken: 'shpat_legacy' }), { request: tokenRequest(calls) });
  assert.equal(next.adminToken, 'shpat_legacy');
  assert.equal(calls.length, 0);
});

test('shopify is ready from the shop URL plus client id and secret, and the stored token stays off the API row', async () => {
  assert.equal(keysReady('shopify', creds()), true);
  assert.equal(keysReady('shopify', { shopUrl: SHOP }), false);

  const tenant = await Tenant.create({
    name: 'Leheriya',
    slug: `leheriya-token-${Date.now()}`,
    kind: 'merchant',
    status: 'active',
  });
  await upsertConnection(tenant._id, null, 'shopify', { credentials: creds() });
  const calls = [];
  const loaded = await shopifyCreds(tenant._id, { request: tokenRequest(calls) });
  assert.equal(loaded.adminToken, ISSUED);
  assert.equal(calls.length, 1);

  const row = await shopifyCreds(tenant._id, { request: tokenRequest(calls) });
  assert.equal(row.adminToken, ISSUED);
  assert.equal(calls.length, 1);

  const stored = credsOf(await require('../src/models/ChannelConnection').findOne({ tenantId: tenant._id, channel: 'shopify' }));
  assert.equal(stored.adminToken, ISSUED);
  const dto = toDto(await require('../src/models/ChannelConnection').findOne({ tenantId: tenant._id, channel: 'shopify' }));
  assert.equal(dto.credentials.adminToken, '');
  assert.equal(JSON.stringify(dto).includes(ISSUED), false);
  assert.equal(JSON.stringify(dto).includes(SECRET), false);
});
