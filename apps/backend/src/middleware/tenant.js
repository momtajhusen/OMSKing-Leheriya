const Tenant = require('../models/Tenant');
const { getTenantContext } = require('../lib/tenantContext');

async function tenantMiddleware(req, res, next) {
  try {
    const ctx = getTenantContext();
    const role = req.user?.role;
    const impersonating = req.user?.impersonating;
    const tokenTenantId = req.user?.tenantId;

    if (role === 'platform_admin' && !impersonating) {
      req.tenantId = null;
      req.skipTenantFilter = true;
      if (ctx) {
        ctx.tenantId = null;
        ctx.skipTenantFilter = true;
        ctx.userId = req.user.id;
      }
      return next();
    }

    const tenantId = tokenTenantId;
    if (!tenantId) {
      return res.status(403).json({ success: false, message: 'No tenant on this session', data: null });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(403).json({ success: false, message: 'Tenant not found', data: null });
    }
    if (tenant.kind === 'merchant' && tenant.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'This tenant is suspended', data: null });
    }

    req.tenant = tenant;
    req.tenantId = String(tenant._id);
    req.skipTenantFilter = false;
    if (ctx) {
      ctx.tenantId = req.tenantId;
      ctx.skipTenantFilter = false;
      ctx.userId = req.user.id;
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

function assertTenantMatch(docTenantId, sessionTenantId) {
  return String(docTenantId) === String(sessionTenantId);
}

module.exports = { tenantMiddleware, assertTenantMatch };
