const Order = require('../models/Order');
const { successResponse } = require('../utils/response');
const { HttpError } = require('../utils/httpError');
const { merchantTenant } = require('./products.controller');
const finance = require('../services/finance.service');

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

async function matchSettlement(req, res) {
  const source = String(req.body.source || 'amazon').toLowerCase();
  if (!['amazon', 'myntra'].includes(source)) throw new HttpError(400, 'Settlement file is for Amazon or Myntra');
  const csv = String(req.body.csv || '');
  if (!csv.trim()) throw new HttpError(400, 'Paste or upload a settlement CSV');
  const orders = await skip(Order.find({ tenantId: merchantTenant(req) }).select('orderNo externalOrderId total'));
  const rows = finance.matchSettlement(orders.map((order) => ({
    orderNo: order.orderNo,
    externalOrderId: order.externalOrderId,
    id: order.orderNo,
    total: order.total,
  })), csv, { source });
  return successResponse(res, { source, rows }, 'Settlement matched against Master Orders');
}

async function matchReturnFile(req, res) {
  const csv = String(req.body.csv || '');
  if (!csv.trim()) throw new HttpError(400, 'Paste or upload a return file CSV');
  const orders = await skip(Order.find({ tenantId: merchantTenant(req) }).select('orderNo externalOrderId'));
  const rows = finance.matchReturnFile(orders.map((order) => ({
    orderNo: order.orderNo,
    externalOrderId: order.externalOrderId,
    id: order.orderNo,
  })), csv);
  return successResponse(res, { rows }, 'Return file matched against Master Orders. The payment file was not used.');
}

async function matchCourierBill(req, res) {
  const csv = String(req.body.csv || '');
  if (!csv.trim()) throw new HttpError(400, 'Paste or upload a courier bill CSV');
  const rows = finance.matchCourierBill(csv);
  return successResponse(res, { rows }, 'Courier bill checked. It is not part of the marketplace settlement.');
}

async function salesReport(req, res) {
  const orders = await skip(Order.find({ tenantId: merchantTenant(req) }).select('status total'));
  let count = 0;
  let netSalesPaise = 0;
  for (const order of orders) {
    if (order.status === 'Cancelled') continue;
    count += 1;
    netSalesPaise += Math.round(Number(order.total || 0) * 100);
  }
  return successResponse(res, { orders: count, netSalesPaise }, 'Reports');
}

module.exports = { matchSettlement, matchReturnFile, matchCourierBill, salesReport };
