const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

const SECRET = /password|secret|token|credential|otp|keyhash|apikey/i;
const FINANCE = new Set(['company', 'tax_gst']);
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function objectIdOrNull(id) {
  if (id && mongoose.Types.ObjectId.isValid(id)) return id;
  return null;
}

function summarize(value) {
  if (Array.isArray(value) && value.length > 20) return { count: value.length };
  return value === undefined ? null : value;
}

function diffChanges(before, after) {
  const left = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  const right = after && typeof after === 'object' && !Array.isArray(after) ? after : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changes = [];
  for (const field of keys) {
    if (SECRET.test(field)) continue;
    const prev = summarize(left[field] == null ? null : left[field]);
    const next = summarize(right[field] == null ? null : right[field]);
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    changes.push({ field, before: prev, after: next });
  }
  return changes;
}

async function actorName(actorId) {
  if (!actorId) return '';
  const user = await User.findById(actorId).select('fullName').setOptions({ skipTenantFilter: true });
  return user?.fullName || '';
}

async function recordAudit({
  tenantId,
  actorId,
  actorRole,
  action,
  resourceType,
  resourceId,
  resourceDisplay,
  before,
  after,
  ip,
  userAgent,
  metadata,
}) {
  const changes = diffChanges(before, after);
  if (!changes.length) return null;
  const years = FINANCE.has(resourceType) ? 7 : 3;
  const name = await actorName(actorId);
  const doc = await AuditLog.create({
    tenantId,
    actorId: objectIdOrNull(actorId),
    actorRole: String(actorRole || '').slice(0, 40),
    action: String(action || '').slice(0, 80),
    resourceType: String(resourceType || '').slice(0, 40),
    resourceId: objectIdOrNull(resourceId),
    resourceDisplay: String(resourceDisplay || '').slice(0, 160),
    before: before || null,
    after: after || null,
    changes,
    ip: String(ip || '').slice(0, 80),
    userAgent: String(userAgent || '').slice(0, 240),
    metadata: { ...(metadata || {}), actorName: name },
    expiresAt: new Date(Date.now() + years * YEAR_MS),
  });
  return doc;
}

async function recordFromReq(req, spec) {
  try {
    return await recordAudit({
      ...spec,
      actorId: spec.actorId || req.user?.id,
      actorRole: spec.actorRole || req.user?.role || '',
      ip: req.ip || req.headers?.['x-forwarded-for'] || '',
      userAgent: req.headers?.['user-agent'] || '',
      metadata: {
        route: req.originalUrl || req.url || '',
        method: req.method || '',
        ...(spec.metadata || {}),
      },
    });
  } catch (err) {
    console.error('[audit]', err.message);
    return null;
  }
}

function toAuditDto(row) {
  return {
    id: String(row._id),
    at: row.createdAt,
    actorName: row.metadata?.actorName || '',
    actorRole: row.actorRole || '',
    action: row.action,
    resourceType: row.resourceType,
    resourceDisplay: row.resourceDisplay || '',
    changes: (row.changes || []).map((change) => ({
      field: change.field,
      before: change.before ?? null,
      after: change.after ?? null,
    })),
  };
}

module.exports = { recordAudit, recordFromReq, diffChanges, toAuditDto };
