const { successResponse } = require('../utils/response');
const { merchantTenant } = require('./products.controller');
const { restockReturn } = require('../services/inventory.service');
const returnsFlow = require('../services/returnsFlow.service');

async function approveRestock(req, res) {
  const tenantId = merchantTenant(req);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const data = await restockReturn(tenantId, req.user.id, {
    items,
    referenceId: req.body.referenceId || req.body.returnId,
    reason: req.body.reason,
    destination: req.body.destination,
    movementType: req.body.movementType,
    warehouseCode: req.body.warehouseCode,
  });
  return successResponse(res, data, 'Restock posted. Channel stock updates only for the destination you chose.');
}

async function listReturns(req, res) {
  const rows = await returnsFlow.listReturns(merchantTenant(req));
  return successResponse(res, rows, 'Returns');
}

async function approveReturn(req, res) {
  const row = await returnsFlow.approveReturn(merchantTenant(req), req.params.returnNo);
  return successResponse(res, {
    id: row.returnNo,
    orderId: row.orderNo,
    status: row.status,
    awb: row.labelAwb,
  }, 'Return approved. Restock happens when the parcel is received.');
}

async function receiveReturn(req, res) {
  const data = await returnsFlow.receiveReturn(merchantTenant(req), req.user.id, req.params.returnNo, {
    destination: req.body.destination || 'All',
    action: req.body.action || 'restock',
  });
  return successResponse(res, {
    id: data.row.returnNo,
    status: data.row.status,
    restockDestination: data.row.restockDestination,
    restock: data.restock,
  }, 'Return received');
}

module.exports = { approveRestock, listReturns, approveReturn, receiveReturn };
