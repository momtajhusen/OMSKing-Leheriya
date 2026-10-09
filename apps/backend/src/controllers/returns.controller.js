const { successResponse } = require('../utils/response');
const { merchantTenant } = require('./products.controller');
const { restockReturn } = require('../services/inventory.service');

async function approveRestock(req, res) {
  const tenantId = merchantTenant(req);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const data = await restockReturn(tenantId, req.user.id, {
    items,
    referenceId: req.body.referenceId || req.body.returnId,
    reason: req.body.reason,
  });
  return successResponse(res, data, 'Return restocked to Offline WH-001; Amazon and Myntra ATS updated');
}

module.exports = { approveRestock };
