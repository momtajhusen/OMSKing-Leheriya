const { HttpError } = require('../utils/httpError');

function sessionTenantId(req) {
  if (req.skipTenantFilter) return req.user?.homeTenantId;
  return req.tenantId;
}

function assertSameTenant(req, docTenantId) {
  const expected = sessionTenantId(req);
  if (!expected || String(docTenantId) !== String(expected)) {
    throw new HttpError(404, 'Not found');
  }
}

module.exports = { sessionTenantId, assertSameTenant };
