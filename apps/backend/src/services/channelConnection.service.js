const ChannelConnection = require('../models/ChannelConnection');
const { encryptObject, decryptObject } = require('../lib/secretBox');
const { HttpError } = require('../utils/httpError');

const SECRET_KEYS = new Set([
  'secretKey', 'token', 'refreshToken', 'lwaClientSecret', 'adminToken',
  'apiToken', 'applicationSecret', 'apiSecret',
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
  row.credentialsEnc = encryptObject(next);
  if (body.importOrdersFrom) row.importOrdersFrom = body.importOrdersFrom;
  if (body.warehouseCode != null) row.warehouseCode = body.warehouseCode;
  row.status = Object.keys(next).length ? 'saved' : 'not_configured';
  row.updatedBy = userId;
  await row.save();
  return row;
}

function credsOf(row) {
  return decryptObject(row?.credentialsEnc);
}

function toDto(row, { reveal = false } = {}) {
  if (!row) return null;
  const credentials = publicCreds(credsOf(row), reveal);
  return {
    id: String(row._id),
    channel: row.channel,
    status: row.status,
    lastTestAt: row.lastTestAt,
    lastTestOk: row.lastTestOk,
    lastTestMessage: row.lastTestMessage,
    importOrdersFrom: row.importOrdersFrom,
    warehouseCode: row.warehouseCode,
    credentials,
    hasSecrets: Boolean(row.credentialsEnc),
  };
}

async function recordTest(row, result) {
  const ok = Boolean(result.ok);
  row.lastTestAt = new Date();
  row.lastTestOk = ok;
  row.lastTestMessage = String(result.message || '').slice(0, 500);
  if (ok) row.status = 'connected';
  else if (result.incomplete) row.status = 'saved';
  else row.status = 'error';
  await row.save();
}

module.exports = {
  getConnection,
  upsertConnection,
  credsOf,
  toDto,
  recordTest,
  HttpError,
};
