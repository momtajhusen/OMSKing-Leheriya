/**
 * JWT access token → req.user { id, role, permissions[], tenantId }.
 * tenantId MUST come from the token. Never from body/query/params.
 */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      data: null,
    });
  }
  // Phase 2: verify JWT, attach req.user
  req.user = req.user || null;
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired access token',
      data: null,
    });
  }
  return next();
}

module.exports = { authMiddleware };
