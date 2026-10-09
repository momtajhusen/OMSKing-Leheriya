const { successResponse, paginatedResponse } = require('../utils/response');
const { pageOf } = require('../utils/page');
const { merchantTenant } = require('./products.controller');
const tracking = require('../services/tracking.service');

async function poll(req, res) {
  const data = await tracking.pollOpenShipments(merchantTenant(req));
  return successResponse(res, data, data.checked
    ? `Checked ${data.checked} Delhivery shipment${data.checked === 1 ? '' : 's'}`
    : 'No open Delhivery shipment to check');
}

async function listNdr(req, res) {
  const rows = await tracking.listNdr(merchantTenant(req));
  const paged = pageOf(rows, req.query);
  return paginatedResponse(res, paged.rows, paged.page, paged.limit, paged.total, 'NDR cases');
}

async function reattempt(req, res) {
  const data = await tracking.reattemptNdr(merchantTenant(req), req.params.orderNo, {
    phone: req.body.phone,
    address: req.body.address,
  });
  return successResponse(res, {
    orderNo: data.ndr.orderNo,
    status: data.ndr.status,
    attempt: data.ndr.attempt,
    createdOrder: data.createdOrder,
  }, 'Reattempt sent on the same order');
}

async function toRto(req, res) {
  const data = await tracking.convertNdrToRto(merchantTenant(req), req.params.orderNo);
  return successResponse(res, {
    orderNo: data.order.orderNo,
    channelStatus: data.order.channelStatus,
    createdOrder: data.createdOrder,
  }, 'Marked RTO on the same order');
}

module.exports = { listNdr, reattempt, toRto, poll };
