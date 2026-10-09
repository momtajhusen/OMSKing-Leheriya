const { successResponse } = require('../utils/response');
const { HttpError } = require('../utils/httpError');
const { sessionTenantId } = require('../lib/tenantAccess');
const {
  getConnection, upsertConnection, credsOf, toDto, recordTest,
} = require('../services/channelConnection.service');
const { pingChannel } = require('../services/channelPing.service');
const shopify = require('../adapters/shopify');
const { recordFromReq } = require('../services/auditLog.service');

function channelSnap(dto) {
  if (!dto) return null;
  const creds = dto.credentials || {};
  return {
    status: dto.status,
    warehouseCode: dto.warehouseCode || '',
    importOrdersFrom: dto.importOrdersFrom || null,
    credentialFields: Object.keys(creds).filter((key) => String(creds[key] || '').trim()).sort(),
    hasSecrets: Boolean(dto.hasSecrets),
  };
}

function merchantTenant(req) {
  const tenantId = sessionTenantId(req);
  if (!tenantId || req.skipTenantFilter) throw new HttpError(400, 'Open a merchant tenant first');
  return tenantId;
}

async function listConnections(req, res) {
  const tenantId = merchantTenant(req);
  const ChannelConnection = require('../models/ChannelConnection');
  const rows = await ChannelConnection.find({ tenantId }).setOptions({ skipTenantFilter: true });
  return successResponse(res, rows.map((row) => toDto(row)), 'Channel connections');
}

async function saveConnection(req, res) {
  const tenantId = merchantTenant(req);
  const channel = String(req.params.channel || '').toLowerCase();
  const { isKnownChannel } = require('../channels/registry');
  if (!isKnownChannel(channel)) {
    throw new HttpError(400, 'Unknown channel');
  }
  const existing = await getConnection(tenantId, channel);
  const before = channelSnap(toDto(existing));
  const row = await upsertConnection(tenantId, req.user.id, channel, req.body);
  const after = channelSnap(toDto(row));
  const touchedSecret = Object.entries(req.body?.credentials || {}).some(([, value]) => String(value || '').trim());
  after.secretsUpdated = touchedSecret;
  await recordFromReq(req, {
    tenantId,
    action: 'channel.updated',
    resourceType: 'channels',
    resourceId: row._id,
    resourceDisplay: channel,
    before: before ? { ...before, secretsUpdated: false } : null,
    after,
  });
  return successResponse(res, toDto(row), 'Channel saved');
}

async function testConnection(req, res) {
  const tenantId = merchantTenant(req);
  const channel = String(req.params.channel || '').toLowerCase();
  const row = await getConnection(tenantId, channel);
  if (!row) throw new HttpError(404, 'Save credentials first');
  let result;
  try {
    result = await pingChannel(channel, credsOf(row));
  } catch (err) {
    result = { ok: false, message: err.message || 'Network error' };
  }
  const before = channelSnap(toDto(row));
  await recordTest(row, result);
  await recordFromReq(req, {
    tenantId,
    action: 'channel.tested',
    resourceType: 'channels',
    resourceId: row._id,
    resourceDisplay: channel,
    before,
    after: channelSnap(toDto(row)),
  });
  return successResponse(res, { ...toDto(row), ok: result.ok, incomplete: Boolean(result.incomplete) }, result.message);
}

async function listShopifyVendors(req, res) {
  const tenantId = merchantTenant(req);
  const row = await getConnection(tenantId, 'shopify');
  if (!row) throw new HttpError(400, 'Save the Shopify shop URL and Admin API token in Settings → Channel Connections first');
  let names;
  try {
    names = await shopify.listProductVendors(credsOf(row));
  } catch (err) {
    throw new HttpError(err.statusCode || 502, err.message || 'Could not fetch Shopify vendors');
  }
  return successResponse(res, names, 'Shopify vendors');
}

module.exports = { listConnections, saveConnection, testConnection, listShopifyVendors };
