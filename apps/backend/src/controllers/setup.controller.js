const { HttpError } = require('../utils/httpError');
const { successResponse } = require('../utils/response');
const { sessionTenantId } = require('../lib/tenantAccess');
const { tenantChecklist, platformChecklist } = require('../services/setupChecklist.service');

async function tenantSetup(req, res) {
  const tenantId = sessionTenantId(req);
  if (!tenantId || req.skipTenantFilter) throw new HttpError(400, 'Open a merchant tenant first');
  return successResponse(res, await tenantChecklist(tenantId), 'Setup checklist');
}

async function platformSetup(req, res) {
  if (req.user?.role !== 'platform_admin' || req.user?.impersonating) {
    throw new HttpError(403, 'Platform setup is only for the platform admin');
  }
  return successResponse(res, await platformChecklist(), 'Platform setup checklist');
}

module.exports = { tenantSetup, platformSetup };
