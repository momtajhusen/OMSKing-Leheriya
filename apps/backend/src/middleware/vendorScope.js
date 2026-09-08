/**
 * Vendor may only see assigned vendor rows. Wrong id → 404 (no enumeration).
 */
function vendorScope(resource) {
  return function vendorScopeMiddleware(req, res, next) {
    if (req.user?.role !== 'vendor') return next();
    const assigned = req.user.assignedVendorIds || [];
    req.vendorScope = { resource, assignedVendorIds: assigned };
    return next();
  };
}

module.exports = { vendorScope };
