process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const amazon = require('../src/adapters/amazon');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { getConnection, credsOf } = require('../src/services/channelConnection.service');
const AuditLog = require('../src/models/AuditLog');

const PASSWORD = 'Password1';
const APP_ID = 'amzn1.sp.solution.test-app-0001';
const CLIENT_ID = 'amzn1.application-oa2-client.testclient0000000000000000000000';
const CLIENT_SECRET = 'amzn1.oa2-cs.v1.testsecret00000000000000000000000000000000000000000000';
const REFRESH = `Atzr|${'R'.repeat(120)}`;
const REDIRECT = 'https://admin.example.com/channels/amazon/callback';
const SELLER = 'A1F9Y5L2KINW89';

let memory;
let server;
let base;
let lwaCalls = [];
let lwaReply = null;
const realHttpsCall = amazon.httpsCall;

const APP_ENV = {
  AMAZON_APPLICATION_ID: APP_ID,
  AMAZON_LWA_CLIENT_ID: CLIENT_ID,
  AMAZON_LWA_CLIENT_SECRET: CLIENT_SECRET,
  AMAZON_OAUTH_REDIRECT_URI: REDIRECT,
};

function setAppEnv(on) {
  Object.entries(APP_ENV).forEach(([key, value]) => {
    if (on) process.env[key] = value;
    else delete process.env[key];
  });
}

async function api(method, path, { token, json } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body, text };
}

async function company(label) {
  const ownerEmail = `owner-${label}-${Date.now()}@example.com`;
  const created = await provisionMerchant({
    name: `Amazon OAuth ${label}`,
    ownerEmail,
    ownerName: 'Owner',
    password: PASSWORD,
    status: 'active',
  });
  const res = await api('POST', '/api/v1/auth/login', { json: { email: ownerEmail, password: PASSWORD } });
  assert.equal(res.status, 200, res.text);
  return { tenant: created.tenant, token: res.body.data.accessToken };
}

async function startState(token) {
  const res = await api('GET', '/api/v1/channels/amazon/authorize', { token });
  assert.equal(res.status, 200, res.text);
  return new URL(res.body.data.url).searchParams.get('state');
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  amazon.httpsCall = async (method, url, opts = {}) => {
    lwaCalls.push({ method, url, body: String(opts.body || '') });
    if (!lwaReply) throw new Error('Amazon must not be called in this test');
    return lwaReply;
  };
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  amazon.httpsCall = realHttpsCall;
  setAppEnv(false);
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test.beforeEach(() => {
  lwaCalls = [];
  lwaReply = null;
  setAppEnv(true);
});

test('authorize link is refused with the missing setting names when the OMSKing Amazon app is not configured', async () => {
  const { token } = await company('noenv');
  setAppEnv(false);
  const res = await api('GET', '/api/v1/channels/amazon/authorize', { token });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /AMAZON_APPLICATION_ID/);
  assert.match(res.body.message, /AMAZON_OAUTH_REDIRECT_URI/);
  assert.equal(lwaCalls.length, 0);
});

test('authorize link goes to Seller Central India consent with the app id, redirect URI, beta flag and a signed state', async () => {
  const { tenant, token } = await company('link');
  const res = await api('GET', '/api/v1/channels/amazon/authorize', { token });
  assert.equal(res.status, 200, res.text);
  const url = new URL(res.body.data.url);
  assert.equal(url.origin, 'https://sellercentral.amazon.in');
  assert.equal(url.pathname, '/apps/authorize/consent');
  assert.equal(url.searchParams.get('application_id'), APP_ID);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('version'), 'beta');
  assert.ok(url.searchParams.get('state'));
  assert.doesNotMatch(res.text, new RegExp(CLIENT_SECRET));
  assert.equal(await getConnection(tenant._id, 'amazon'), null, 'starting the flow saves nothing');
  assert.equal(lwaCalls.length, 0, 'no Amazon call to build the link');
});

test('callback exchanges the code once, saves refresh token + app keys + seller id, sets Live and Connected, and never returns secrets', async () => {
  const { tenant, token } = await company('ok');
  const state = await startState(token);
  lwaReply = { status: 200, text: JSON.stringify({ access_token: 'Atza|x', refresh_token: REFRESH, token_type: 'bearer', expires_in: 3600 }) };

  const res = await api('POST', '/api/v1/channels/amazon/authorize', {
    token,
    json: { state, code: 'ANcode123', sellingPartnerId: SELLER },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(lwaCalls.length, 1);
  assert.equal(lwaCalls[0].url, 'https://api.amazon.com/auth/o2/token');
  const sent = new URLSearchParams(lwaCalls[0].body);
  assert.equal(sent.get('grant_type'), 'authorization_code');
  assert.equal(sent.get('code'), 'ANcode123');
  assert.equal(sent.get('redirect_uri'), REDIRECT);
  assert.equal(sent.get('client_id'), CLIENT_ID);
  assert.equal(sent.get('client_secret'), CLIENT_SECRET);

  assert.equal(res.body.data.status, 'connected');
  assert.equal(res.body.data.lastTestOk, true);
  assert.equal(res.body.data.lastTestMode, 'live');
  assert.equal(res.body.data.credentials.apiMode, 'live');
  assert.equal(res.body.data.credentials.sellerId, SELLER);
  assert.doesNotMatch(res.text, /Atzr\|/);
  assert.doesNotMatch(res.text, new RegExp(CLIENT_SECRET));

  const row = await getConnection(tenant._id, 'amazon');
  const creds = credsOf(row);
  assert.equal(creds.refreshToken, REFRESH);
  assert.equal(creds.lwaClientId, CLIENT_ID);
  assert.equal(creds.lwaClientSecret, CLIENT_SECRET);
  assert.equal(creds.sellerId, SELLER);
  assert.equal(creds.apiMode, 'live');
  assert.equal(creds.marketplaceId, 'A21TJRUUN4KGV');
  assert.equal(creds.applicationId, APP_ID);

  const audit = await AuditLog.findOne({ tenantId: tenant._id, action: 'channel.authorized' }).lean();
  assert.ok(audit, 'authorization is audited');
  assert.doesNotMatch(JSON.stringify(audit), /Atzr\||oa2-cs/);
});

test('re-authorizing keeps a marketplace already chosen and replaces the old refresh token', async () => {
  const { tenant, token } = await company('again');
  await api('PATCH', '/api/v1/channels/amazon', {
    token,
    json: { credentials: { apiMode: 'sandbox', sellerId: 'AOLDSELLER01', refreshToken: `Atzr|${'O'.repeat(60)}`, marketplaceId: 'A21TJRUUN4KGV' } },
  });
  const state = await startState(token);
  lwaReply = { status: 200, text: JSON.stringify({ refresh_token: REFRESH }) };
  const res = await api('POST', '/api/v1/channels/amazon/authorize', { token, json: { state, code: 'c2', sellingPartnerId: SELLER } });
  assert.equal(res.status, 200, res.text);
  const creds = credsOf(await getConnection(tenant._id, 'amazon'));
  assert.equal(creds.refreshToken, REFRESH);
  assert.equal(creds.sellerId, SELLER);
  assert.equal(creds.apiMode, 'live');
});

test('a state started by another company is refused and Amazon is not called', async () => {
  const first = await company('a');
  const second = await company('b');
  const state = await startState(first.token);
  lwaReply = { status: 200, text: JSON.stringify({ refresh_token: REFRESH }) };
  const res = await api('POST', '/api/v1/channels/amazon/authorize', { token: second.token, json: { state, code: 'x', sellingPartnerId: SELLER } });
  assert.equal(res.status, 403);
  assert.equal(lwaCalls.length, 0);
  assert.equal(await getConnection(second.tenant._id, 'amazon'), null);
});

test('an expired or forged state is refused and Amazon is not called', async () => {
  const { tenant, token } = await company('bad');
  lwaReply = { status: 200, text: JSON.stringify({ refresh_token: REFRESH }) };
  const forged = jwt.sign({ p: 'amazon_oauth', t: String(tenant._id) }, 'wrong-secret', { expiresIn: '10m' });
  for (const state of ['not-a-state', forged]) {
    const res = await api('POST', '/api/v1/channels/amazon/authorize', { token, json: { state, code: 'x', sellingPartnerId: SELLER } });
    assert.equal(res.status, 400, state);
    assert.match(res.body.message, /Authorize with Amazon again/);
  }
  assert.equal(lwaCalls.length, 0);
});

test('missing code or seller id is refused before Amazon is called', async () => {
  const { token } = await company('missing');
  const state = await startState(token);
  const noCode = await api('POST', '/api/v1/channels/amazon/authorize', { token, json: { state, sellingPartnerId: SELLER } });
  assert.equal(noCode.status, 400);
  const noSeller = await api('POST', '/api/v1/channels/amazon/authorize', { token, json: { state, code: 'x' } });
  assert.equal(noSeller.status, 400);
  assert.equal(lwaCalls.length, 0);
});

test('a failed token exchange shows Amazon\'s reason and saves nothing', async () => {
  const { tenant, token } = await company('fail');
  const state = await startState(token);
  lwaReply = { status: 400, text: JSON.stringify({ error: 'invalid_grant', error_description: 'The authorization code is invalid or expired' }) };
  const res = await api('POST', '/api/v1/channels/amazon/authorize', { token, json: { state, code: 'old', sellingPartnerId: SELLER } });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /authorization code is invalid or expired/);
  assert.doesNotMatch(res.text, new RegExp(CLIENT_SECRET));
  assert.equal(await getConnection(tenant._id, 'amazon'), null);
});
