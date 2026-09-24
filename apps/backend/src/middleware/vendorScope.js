const { HttpError } = require('../utils/httpError');

/**
 * Vendor data scope (not a permission key). Assigned vendor ids live on the user.
 * Missing id → 404 so tenants cannot enumerate other vendors' rows.
 */
function vendorScope(resource) {
  return function vendorScopeMiddleware(req, res, next) {
    if (req.user?.role !== 'vendor') return next();
    const assigned = (req.user.assignedVendorIds || []).map(String);
    req.vendorScope = { resource, assignedVendorIds: assigned };
    const rawId = req.params.vendorId || req.body?.vendorId;
    if (rawId && !assigned.includes(String(rawId))) {
      return next(new HttpError(404, 'Not found'));
    }
    return next();
  };
}

module.exports = { vendorScope };
