const { successResponse } = require('../utils/response');
const { HttpError } = require('../utils/httpError');
const { sessionTenantId } = require('../lib/tenantAccess');
const {
  getConnection, upsertConnection, credsOf, toDto, recordTest,
} = require('../services/channelConnection.service');
const { pingChannel } = require('../services/channelPing.service');

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
  if (!['shopify', 'amazon', 'myntra', 'flipkart', 'meesho', 'ajio', 'nykaa'].includes(channel)) {
    throw new HttpError(400, 'Unknown channel');
  }
  const row = await upsertConnection(tenantId, req.user.id, channel, req.body);
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
  await recordTest(row, result);
  return successResponse(res, { ...toDto(row), ok: result.ok, incomplete: Boolean(result.incomplete) }, result.message);
}

module.exports = { listConnections, saveConnection, testConnection };
