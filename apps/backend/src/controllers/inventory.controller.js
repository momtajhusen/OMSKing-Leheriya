const { successResponse, paginatedResponse } = require('../utils/response');
const { HttpError } = require('../utils/httpError');
const { merchantTenant } = require('./products.controller');
const {
  listBalances, channelAts, stockIn, stockOut, adjustStock, setReorderPoint,
  reserveStock, releaseReservation, consumeReservation, listLedger, lowStockAlerts, stressReserve,
} = require('../services/inventory.service');

async function list(req, res) {
  const tenantId = merchantTenant(req);
  const all = await listBalances(tenantId, {
    warehouseId: req.query.warehouseId,
    q: req.query.q,
  });
  const tab = req.query.tab;
  let rows = all;
  if (tab === 'low') rows = all.filter((row) => row.low);
  if (tab === 'reserved') rows = all.filter((row) => row.reserved > 0);
  if (tab === 'available') rows = all.filter((row) => row.available > 0 && !row.low);
  const kpis = all.reduce((acc, row) => {
    acc.totalStock += row.stock;
    acc.reserved += row.reserved;
    acc.available += row.available;
    acc.stockValue += row.stock * (row.cost || 0);
    if (row.low) acc.low += 1;
    return acc;
  }, { totalStock: 0, reserved: 0, available: 0, stockValue: 0, low: 0 });
  return successResponse(res, { rows, kpis }, 'Inventory');
}

async function ats(req, res) {
  const tenantId = merchantTenant(req);
  if (!req.query.masterSkuId) throw new HttpError(400, 'masterSkuId is required');
  const data = await channelAts(tenantId, req.query.masterSkuId);
  return successResponse(res, data, 'Available to sell');
}

async function ledger(req, res) {
  const tenantId = merchantTenant(req);
  const data = await listLedger(tenantId, {
    masterSkuId: req.query.masterSkuId,
    warehouseId: req.query.warehouseId,
    limit: req.query.limit,
  });
  return paginatedResponse(res, data, 1, data.length || 50, data.length, 'Inventory ledger');
}

async function alerts(req, res) {
  const tenantId = merchantTenant(req);
  const data = await lowStockAlerts(tenantId);
  return successResponse(res, data, 'Low stock alerts');
}

async function inStock(req, res) {
  const tenantId = merchantTenant(req);
  const data = await stockIn(tenantId, req.user.id, req.body);
  return successResponse(res, data, 'Stock in posted');
}

async function outStock(req, res) {
  const tenantId = merchantTenant(req);
  const data = await stockOut(tenantId, req.user.id, req.body);
  return successResponse(res, data, 'Stock out posted');
}

async function adjust(req, res) {
  const tenantId = merchantTenant(req);
  const data = await adjustStock(tenantId, req.user.id, req.body);
  return successResponse(res, data, 'Stock adjusted');
}

async function threshold(req, res) {
  const tenantId = merchantTenant(req);
  const data = await setReorderPoint(tenantId, req.params.id, req.body.reorderPoint);
  return successResponse(res, data, 'Reorder point saved');
}

async function reserve(req, res) {
  const tenantId = merchantTenant(req);
  const data = await reserveStock(tenantId, req.user.id, req.body);
  return successResponse(res, data, data.idempotent ? 'Reservation already held' : 'Stock reserved');
}

async function release(req, res) {
  const tenantId = merchantTenant(req);
  const data = await releaseReservation(tenantId, req.user.id, req.body);
  return successResponse(res, data, 'Reservation released');
}

async function consume(req, res) {
  const tenantId = merchantTenant(req);
  const data = await consumeReservation(tenantId, req.user.id, req.body);
  return successResponse(res, data, 'Reservation consumed');
}

async function stress(req, res) {
  const tenantId = merchantTenant(req);
  const data = await stressReserve(tenantId, req.user.id, req.body);
  return successResponse(res, data, `Stress test: ${data.held} held, ${data.rejected} rejected`);
}

module.exports = {
  list, ats, ledger, alerts, inStock, outStock, adjust, threshold, reserve, release, consume, stress,
};
