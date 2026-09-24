const User = require('../models/User');
const { verifyAccess } = require('../lib/tokens');

async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required', data: null });
    }
    let decoded;
    try {
      decoded = verifyAccess(token);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired access token', data: null });
    }
    const user = await User.findById(decoded.sub)
      .populate('roleId')
      .setOptions({ skipTenantFilter: true });
    if (!user || user.status === 'disabled') {
      return res.status(401).json({ success: false, message: 'Invalid or expired access token', data: null });
    }
    if (decoded.rv !== user.refreshTokenVersion) {
      return res.status(401).json({ success: false, message: 'Session expired', data: null });
    }
    const impersonating = Boolean(decoded.impersonating);
    req.user = {
      id: String(user._id),
      role: impersonating ? decoded.role : user.roleId.code,
      permissions: impersonating ? (decoded.permissions || []) : (user.roleId.permissions || []),
      tenantId: decoded.tenantId || null,
      homeTenantId: String(user.tenantId),
      impersonating,
      assignedVendorIds: (user.assignedVendorIds || []).map(String),
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { authMiddleware };
