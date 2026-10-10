const ChannelConnection = require('../models/ChannelConnection');
const { encryptObject, decryptObject } = require('../lib/secretBox');
const { HttpError } = require('../utils/httpError');

const SECRET_KEYS = new Set([
  'secretKey', 'token', 'refreshToken', 'lwaClientSecret', 'adminToken',
  'apiToken', 'applicationSecret', 'apiSecret', 'webhookSecret', 'accessToken',
  'sandboxRefreshToken',
]);

function publicCreds(creds, reveal) {
  const out = { ...(creds || {}) };
  if (reveal) return out;
  Object.keys(out).forEach((key) => {
    if (SECRET_KEYS.has(key) && out[key]) out[key] = '';
  });
  return out;
}

async function getConnection(tenantId, channel) {
  return ChannelConnection.findOne({ tenantId, channel }).setOptions({ skipTenantFilter: true });
}

function explicitMode(creds) {
  const mode = String(creds?.apiMode || '').trim().toLowerCase();
  return mode === 'sandbox' || mode === 'live' ? mode : '';
}

function mentionedMode(message) {
  const text = String(message || '').toLowerCase();
  if (/\bsandbox\b/.test(text)) return 'sandbox';
  if (/\blive\b/.test(text)) return 'live';
  return '';
}

function sandboxTokenOnLive(creds) {
  const token = String(creds?.refreshToken || '');
  const sandboxToken = String(creds?.sandboxRefreshToken || '');
  return explicitMode(creds) === 'live' && token && sandboxToken && token === sandboxToken;
}

function amazonLiveReady(creds) {
  const sellerId = String(creds?.sellerId || '').trim();
  const refreshToken = String(creds?.refreshToken || '').trim();
  const clientId = String(creds?.lwaClientId || '').trim();
  const secret = String(creds?.lwaClientSecret || '').trim();
  const sandboxToken = String(creds?.sandboxRefreshToken || '').trim();
  if (!/^A[A-Z0-9]{9,}$/.test(sellerId)) return false;
  if (!refreshToken.startsWith('Atzr|') || refreshToken.length < 40) return false;
  if (sandboxToken && refreshToken === sandboxToken) return false;
  if (!clientId.startsWith('amzn1.application-oa2-client.')) return false;
  if (secret.length < 40) return false;
  return true;
}

function staleEnvironmentTest(row, prev, next) {
  if (!row?.lastTestOk) return false;
  const nextMode = explicitMode(next);
  if (!nextMode) return false;
  if (sandboxTokenOnLive(next)) return true;
  const prevMode = explicitMode(prev);
  const tested = row.lastTestMode || mentionedMode(row.lastTestMessage);
  return (prevMode && prevMode !== nextMode) || (tested && tested !== nextMode);
}

async function upsertConnection(tenantId, userId, channel, body) {
  let row = await getConnection(tenantId, channel);
  const prev = row ? decryptObject(row.credentialsEnc) : {};
  const next = { ...prev };
  Object.entries(body.credentials || {}).forEach(([key, value]) => {
    if (value === '' || value == null) return;
    next[key] = value;
  });
  if (!row) {
    row = new ChannelConnection({ tenantId, channel });
  }
  const environmentChanged = staleEnvironmentTest(row, prev, next);
  row.credentialsEnc = encryptObject(next);
  if (body.importOrdersFrom) row.importOrdersFrom = body.importOrdersFrom;
  if (body.warehouseCode != null) row.warehouseCode = body.warehouseCode;
  row.status = Object.keys(next).length ? 'saved' : 'not_configured';
  if (environmentChanged) {
    const nextMode = explicitMode(next);
    row.lastTestOk = false;
    row.lastTestMessage = nextMode === 'live'
      ? 'API environment is Live. The previous test passed on Sandbox, so Live is not connected. Test again with a production refresh token, or switch this field back to Sandbox.'
      : 'API environment is Sandbox. The previous Live test no longer applies. Test again to connect Sandbox.';
  }
  row.updatedBy = userId;
  await row.save();
  return row;
}

function credsOf(row) {
  return decryptObject(row?.credentialsEnc);
}

async function patchCreds(row, patch) {
  row.credentialsEnc = encryptObject({ ...credsOf(row), ...patch });
  await row.save();
}

function savedSecretKeys(creds) {
  return Object.keys(creds || {}).filter((key) => SECRET_KEYS.has(key) && String(creds[key] || '').trim());
}

function toDto(row, { reveal = false } = {}) {
  if (!row) return null;
  const raw = credsOf(row);
  const credentials = publicCreds(raw, reveal);
  return {
    id: String(row._id),
    channel: row.channel,
    status: row.status,
    lastTestAt: row.lastTestAt,
    lastTestOk: row.lastTestOk,
    lastTestMode: row.lastTestMode || '',
    lastTestMessage: row.lastTestMessage,
    importOrdersFrom: row.importOrdersFrom,
    warehouseCode: row.warehouseCode,
    credentials,
    savedSecretKeys: savedSecretKeys(raw),
    hasSecrets: Boolean(row.credentialsEnc),
  };
}

async function recordTest(row, result) {
  let ok = Boolean(result?.ok);
  let message = String(result?.message || '').slice(0, 500);
  const mode = explicitMode(credsOf(row));
  if (row.channel === 'amazon' && ok && mode === 'sandbox') {
    const token = String(credsOf(row).refreshToken || '').trim();
    if (token) await patchCreds(row, { sandboxRefreshToken: token });
  }
  if (row.channel === 'amazon' && ok && mode === 'live' && !amazonLiveReady(credsOf(row))) {
    ok = false;
    message = 'Live is not connected. Live mode needs the production Seller ID, refresh token, and LWA client id + secret. A sandbox refresh token stays on Sandbox. The live API was not called.';
  }
  if (row.channel === 'amazon' && ok && !mode) {
    ok = false;
    message = 'Live is not connected. Choose Sandbox or Live. The live API was not called.';
  }
  row.lastTestAt = new Date();
  row.lastTestOk = ok;
  row.lastTestMode = mode || (row.channel === 'amazon' ? '' : 'live');
  row.lastTestMessage = message.slice(0, 500);
  if (ok) row.status = 'connected';
  else if (row.channel === 'amazon' && result?.ok && (mode === 'live' || !mode)) row.status = 'saved';
  else if (result?.incomplete) row.status = 'saved';
  else row.status = 'error';
  await row.save();
  return row;
}

module.exports = {
  getConnection,
  upsertConnection,
  credsOf,
  patchCreds,
  toDto,
  recordTest,
  amazonLiveReady,
  HttpError,
};
