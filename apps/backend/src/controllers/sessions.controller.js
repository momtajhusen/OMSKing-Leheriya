const RefreshSession = require('../models/RefreshSession');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { HttpError } = require('../utils/httpError');
const { successResponse } = require('../utils/response');
const { sessionTenantId, assertSameTenant } = require('../lib/tenantAccess');

async function listSessions(req, res) {
  const tenantId = sessionTenantId(req);
  const filter = req.user?.role === 'platform_admin' && !req.user?.impersonating
    ? {}
    : { tenantId };
  if (!req.skipTenantFilter && !tenantId) throw new HttpError(400, 'No tenant on this session');
  const rows = await RefreshSession.find(filter).sort({ lastActiveAt: -1 }).limit(200).setOptions({ skipTenantFilter: true });
  const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } })
    .populate(['roleId', 'tenantId'])
    .setOptions({ skipTenantFilter: true });
  const byId = Object.fromEntries(users.map((u) => [String(u._id), u]));
  const tenants = await Tenant.find({ _id: { $in: rows.map((r) => r.tenantId) } });
  const tById = Object.fromEntries(tenants.map((t) => [String(t._id), t]));
  const q = (req.query.q || '').toLowerCase();
  const data = rows.map((s) => {
    const u = byId[String(s.userId)];
    const t = tById[String(s.tenantId)];
    return {
      id: String(s._id),
      user: u?.fullName || 'Unknown',
      email: u?.email || '',
      tenant: t?.name || '',
      role: u?.roleId?.code,
      device: s.device,
      ip: s.ip,
      lastActive: s.lastActiveAt,
      status: s.revokedAt ? 'Revoked' : (s.expiresAt < new Date() ? 'Expired' : 'Active'),
    };
  }).filter((s) => !q || s.user.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  return successResponse(res, data, 'Sessions');
}

async function revokeSession(req, res) {
  const session = await RefreshSession.findById(req.params.id).setOptions({ skipTenantFilter: true });
  if (!session) throw new HttpError(404, 'Session not found');
  if (!(req.user?.role === 'platform_admin' && !req.user?.impersonating)) {
    assertSameTenant(req, session.tenantId);
  }
  session.revokedAt = new Date();
  await session.save();
  return successResponse(res, null, 'Session revoked');
}

module.exports = { listSessions, revokeSession };
