const AuditLog = require('../models/AuditLog');
const { successResponse } = require('../utils/response');
const { sessionTenantId } = require('../lib/tenantAccess');
const { HttpError } = require('../utils/httpError');
const { toAuditDto } = require('../services/auditLog.service');

async function list(req, res) {
  const tenantId = sessionTenantId(req);
  if (!tenantId || req.skipTenantFilter) throw new HttpError(400, 'Open a merchant tenant first');
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const rows = await AuditLog.find({ tenantId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .setOptions({ skipTenantFilter: true });
  const q = String(req.query.q || '').trim().toLowerCase();
  let data = rows.map(toAuditDto);
  if (q) {
    data = data.filter((row) => [row.actorName, row.actorRole, row.action, row.resourceType, row.resourceDisplay]
      .some((value) => String(value || '').toLowerCase().includes(q))
      || (row.changes || []).some((change) => String(change.field || '').toLowerCase().includes(q)));
  }
  return successResponse(res, data, 'Audit logs');
}

module.exports = { list };
