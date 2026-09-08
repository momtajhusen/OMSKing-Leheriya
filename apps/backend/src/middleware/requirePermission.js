const { hasPermission } = require('../constants/permissions');

/**
 * Do not authorize by role name. Check the permission key on the user/role document.
 * Example: requirePermission('orders.cancel')
 */
function requirePermission(key) {
  return function requirePermissionMiddleware(req, res, next) {
    const granted = req.user?.permissions || [];
    if (!hasPermission(granted, key)) {
      return res.status(403).json({
        success: false,
        message: `Missing permission: ${key}`,
        data: null,
      });
    }
    return next();
  };
}

module.exports = { requirePermission };
