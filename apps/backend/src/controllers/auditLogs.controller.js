const AuditLog = require('../models/AuditLog');
const { paginatedResponse } = require('../utils/response');
const { pageOf } = require('../utils/page');
const { sessionTenantId } = require('../lib/tenantAccess');
const { HttpError } = require('../utils/httpError');
const { toAuditDto } = require('../services/auditLog.service');

function matchesQuery(row, q) {
  if (!q) return true;
  return [row.actorName, row.actorRole, row.action, row.resourceType, row.resourceDisplay]
    .some((value) => String(value || '').toLowerCase().includes(q))
    || (row.changes || []).some((change) => String(change.field || '').toLowerCase().includes(q)
      || String(change.before || '').toLowerCase().includes(q)
      || String(change.after || '').toLowerCase().includes(q));
}

async function list(req, res) {
  const tenantId = sessionTenantId(req);
  if (!tenantId || req.skipTenantFilter) throw new HttpError(400, 'Open a merchant tenant first');
  const q = String(req.query.q || '').trim().toLowerCase();
  const asked = req.query.page !== undefined && req.query.page !== null && String(req.query.page) !== '';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const filter = { tenantId };

  if (q) {
    const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(500).setOptions({ skipTenantFilter: true });
    const data = rows.map(toAuditDto).filter((row) => matchesQuery(row, q));
    const paged = pageOf(data, req.query);
    return paginatedResponse(res, paged.rows, paged.page, paged.limit, paged.total, 'Audit logs');
  }

  const total = await AuditLog.countDocuments(filter).setOptions({ skipTenantFilter: true });
  const query = AuditLog.find(filter).sort({ createdAt: -1 }).setOptions({ skipTenantFilter: true });
  if (asked) query.skip((page - 1) * limit).limit(limit);
  else query.limit(500);
  const rows = await query;
  return paginatedResponse(res, rows.map(toAuditDto), asked ? page : 1, asked ? limit : (rows.length || limit), total, 'Audit logs');
}

module.exports = { list };
