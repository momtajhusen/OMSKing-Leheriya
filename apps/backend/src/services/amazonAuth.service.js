const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const amazon = require('../adapters/amazon');
const { HttpError } = require('../utils/httpError');
const { getConnection, upsertConnection, credsOf, amazonLiveReady } = require('./channelConnection.service');

const LWA_URL = 'https://api.amazon.com/auth/o2/token';
const INDIA = 'A21TJRUUN4KGV';
const STATE_PURPOSE = 'amazon_oauth';
const STATE_TTL = '10m';
const RESTART = 'Click Authorize with Amazon again.';

/** The OMSKing developer app every seller authorizes. Read on each call so a changed .env needs no code change. */
function appConfig(env = process.env) {
  return {
    applicationId: String(env.AMAZON_APPLICATION_ID || '').trim(),
    clientId: String(env.AMAZON_LWA_CLIENT_ID || '').trim(),
    clientSecret: String(env.AMAZON_LWA_CLIENT_SECRET || '').trim(),
    redirectUri: String(env.AMAZON_OAUTH_REDIRECT_URI || '').trim(),
    sellerCentralUrl: String(env.AMAZON_SELLER_CENTRAL_URL || 'https://sellercentral.amazon.in').trim().replace(/\/+$/, ''),
    beta: String(env.AMAZON_OAUTH_BETA ?? 'true').trim().toLowerCase() !== 'false',
  };
}

function assertConfigured(app) {
  const missing = [
    ['AMAZON_APPLICATION_ID', app.applicationId],
    ['AMAZON_LWA_CLIENT_ID', app.clientId],
    ['AMAZON_LWA_CLIENT_SECRET', app.clientSecret],
    ['AMAZON_OAUTH_REDIRECT_URI', app.redirectUri],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new HttpError(400, `Authorize with Amazon is not set up on this server. Missing: ${missing.join(', ')}. Use the manual form below, or ask the OMSKing admin to add them.`);
  }
}

function stateSecret() {
  return `${config.jwt.accessSecret}:${STATE_PURPOSE}`;
}

function signState(tenantId, userId) {
  return jwt.sign(
    { p: STATE_PURPOSE, t: String(tenantId), u: String(userId), n: crypto.randomBytes(12).toString('hex') },
    stateSecret(),
    { expiresIn: STATE_TTL },
  );
}

function readState(state, tenantId, userId) {
  let claims;
  try {
    claims = jwt.verify(String(state || ''), stateSecret());
  } catch {
    throw new HttpError(400, `This Amazon authorization expired or is not valid. ${RESTART}`);
  }
  if (claims.p !== STATE_PURPOSE) throw new HttpError(400, `This Amazon authorization is not valid. ${RESTART}`);
  if (claims.t !== String(tenantId) || claims.u !== String(userId)) {
    throw new HttpError(403, 'This Amazon authorization was started from a different OMSKing account. Sign in to that account, or start again here.');
  }
}

/** Seller Central consent link for this tenant; nothing is saved and Amazon is not called. */
function authorizeUrl(tenantId, userId, env = process.env) {
  const app = appConfig(env);
  assertConfigured(app);
  const qs = new URLSearchParams({
    application_id: app.applicationId,
    state: signState(tenantId, userId),
    redirect_uri: app.redirectUri,
  });
  if (app.beta) qs.set('version', 'beta');
  return `${app.sellerCentralUrl}/apps/authorize/consent?${qs}`;
}

async function exchangeCode(app, code, request) {
  const res = await request('POST', LWA_URL, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: app.redirectUri,
      client_id: app.clientId,
      client_secret: app.clientSecret,
    }).toString(),
  });
  let body = {};
  try { body = JSON.parse(res.text || '{}'); } catch { body = {}; }
  const refreshToken = String(body.refresh_token || '').trim();
  if (res.status < 200 || res.status >= 300 || !refreshToken) {
    const reason = amazon.lwaDetail(res.text) || 'no refresh token was returned';
    throw new HttpError(res.status >= 500 ? 502 : 400, `Amazon did not connect: ${reason}. Nothing was saved. ${RESTART}`);
  }
  return refreshToken;
}

/**
 * Amazon redirect -> refresh token saved on this tenant's Amazon channel, mode Live, status Connected.
 * The token exchange is the only Amazon call; a successful exchange is the connection proof.
 */
async function completeAuthorization(tenantId, userId, body = {}, { request, env = process.env } = {}) {
  const app = appConfig(env);
  assertConfigured(app);
  readState(body.state, tenantId, userId);
  const code = String(body.code || '').trim();
  const sellerId = String(body.sellingPartnerId || '').trim();
  if (!code) throw new HttpError(400, `Amazon did not send an authorization code. ${RESTART}`);
  if (!/^A[A-Z0-9]{9,}$/.test(sellerId)) throw new HttpError(400, `Amazon did not send a valid seller id. ${RESTART}`);

  const refreshToken = await exchangeCode(app, code, request || amazon.httpsCall);
  const saved = credsOf(await getConnection(tenantId, 'amazon')) || {};
  const credentials = {
    apiMode: 'live',
    sellerId,
    refreshToken,
    lwaClientId: app.clientId,
    lwaClientSecret: app.clientSecret,
    applicationId: app.applicationId,
    marketplaceId: String(saved.marketplaceId || '').trim() || INDIA,
  };
  if (!amazonLiveReady({ ...saved, ...credentials })) {
    throw new HttpError(400, 'Amazon answered, but the OMSKing app keys on this server are not production LWA keys, so nothing was saved. Check AMAZON_LWA_CLIENT_ID and AMAZON_LWA_CLIENT_SECRET.');
  }
  const row = await upsertConnection(tenantId, userId, 'amazon', { credentials });
  row.status = 'connected';
  row.lastTestOk = true;
  row.lastTestMode = 'live';
  row.lastTestAt = new Date();
  row.lastTestMessage = `Connected with Authorize with Amazon for seller ${sellerId}.`;
  await row.save();
  return row;
}

module.exports = { authorizeUrl, completeAuthorization, appConfig };
