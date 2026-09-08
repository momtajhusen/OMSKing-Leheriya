/**
 * Tenant isolation (server-side). A user on Tenant A must never read Tenant B.
 * req.tenantId is copied from JWT only.
 */
function tenantMiddleware(req, res, next) {
  const tenantId = req.user && req.user.tenantId;
  if (req.user?.role === 'platform_admin' && req.user.impersonating && req.user.tenantId) {
    req.tenantId = req.user.tenantId;
    return next();
  }
  if (req.user?.role === 'platform_admin' && !req.user.tenantId) {
    req.tenantId = null;
    req.skipTenantFilter = true;
    return next();
  }
  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message: 'No tenant on this session',
      data: null,
    });
  }
  req.tenantId = String(tenantId);
  req.skipTenantFilter = false;
  return next();
}

function assertTenantMatch(docTenantId, sessionTenantId) {
  return String(docTenantId) === String(sessionTenantId);
}

module.exports = { tenantMiddleware, assertTenantMatch };
