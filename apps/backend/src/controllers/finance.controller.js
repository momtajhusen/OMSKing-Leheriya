const crypto = require('crypto');
const Order = require('../models/Order');
const Shipment = require('../models/Shipment');
const SettlementImport = require('../models/SettlementImport');
const { successResponse } = require('../utils/response');
const { HttpError } = require('../utils/httpError');
const { merchantTenant } = require('./products.controller');
const { scopedVendorNames } = require('./vendors.controller');
const finance = require('../services/finance.service');
const { codCollectAmount } = require('../utils/payment');

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

/** Tenant from the JWT; vendor logins only reach orders with a sub-order of their own vendors. */
async function orderScope(req) {
  const tenantId = merchantTenant(req);
  const filter = { tenantId };
  if (!req.vendorScope?.active) return { tenantId, filter, names: null };
  const names = (await scopedVendorNames(tenantId, req.vendorScope.assignedVendorIds)).map((name) => name.toLowerCase());
  filter['subOrders.assignedVendor'] = { $in: names.map((name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) };
  return { tenantId, filter, names };
}

function fileHash(csv) {
  return crypto.createHash('sha256').update(csv.replace(/\r\n?/g, '\n').trim()).digest('hex');
}

async function matchSettlement(req, res) {
  const source = String(req.body.source || 'amazon').toLowerCase();
  if (!['amazon', 'myntra'].includes(source)) throw new HttpError(400, 'Settlement file is for Amazon or Myntra');
  const csv = String(req.body.csv || '');
  if (!csv.trim()) throw new HttpError(400, 'Paste or upload a settlement CSV');
  const { tenantId, filter } = await orderScope(req);
  const hash = fileHash(csv);
  const duplicate = new HttpError(409, 'This settlement file was already imported. Nothing was marked paid again.');
  if (await skip(SettlementImport.exists({ tenantId, hash }))) throw duplicate;
  const orders = await skip(Order.find(filter).select('orderNo externalOrderId channelOrderNo channel total channelLines.sellerOrderId channelLines.packetId'));
  const rows = finance.matchSettlement(orders.map((order) => ({
    orderNo: order.orderNo,
    externalOrderId: order.externalOrderId,
    channelOrderNo: order.channelOrderNo,
    channel: order.channel,
    channelLines: order.channelLines,
    id: order.orderNo,
    total: order.total,
  })), csv, { source, channel: source });
  try {
    await SettlementImport.create({ tenantId, source, hash, rows: rows.length });
  } catch (err) {
    if (err?.code === 11000) throw duplicate;
    throw err;
  }
  const received = rows.filter((row) => row.status === 'matched').map((row) => row.orderNo);
  if (received.length) {
    await skip(Order.updateMany({ ...filter, orderNo: { $in: received } }, { $set: { paymentStatus: 'paid' } }));
  }
  return successResponse(res, { source, rows }, 'Settlement matched against Master Orders');
}

async function matchReturnFile(req, res) {
  const csv = String(req.body.csv || '');
  if (!csv.trim()) throw new HttpError(400, 'Paste or upload a return file CSV');
  const { filter } = await orderScope(req);
  const orders = await skip(Order.find(filter).select('orderNo externalOrderId'));
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
  const awbs = [...new Set(finance.parseCsv(csv).map((row) => String(row.awb || row.waybill || '').trim()).filter(Boolean))];
  const codByAwb = new Map();
  if (awbs.length) {
    const { tenantId, filter } = await orderScope(req);
    const shipments = await skip(Shipment.find({ tenantId, awb: { $in: awbs } }).select('awb orderNo')).lean();
    const orders = await skip(Order.find({
      ...filter,
      $or: [{ awb: { $in: awbs } }, { orderNo: { $in: shipments.map((row) => row.orderNo) } }],
    }).select('orderNo awb paymentMode total codAmount')).lean();
    const byOrderNo = new Map(orders.map((order) => [order.orderNo, order]));
    orders.forEach((order) => { if (awbs.includes(order.awb)) codByAwb.set(order.awb, codCollectAmount(order)); });
    shipments.forEach((row) => {
      const order = byOrderNo.get(row.orderNo);
      if (order && !codByAwb.has(row.awb)) codByAwb.set(row.awb, codCollectAmount(order));
    });
  }
  const rows = finance.matchCourierBill(csv, { codByAwb });
  return successResponse(res, { rows }, 'Courier bill checked. It is not part of the marketplace settlement.');
}

async function salesReport(req, res) {
  const { filter, names } = await orderScope(req);
  const orders = await skip(Order.find(filter).select('status total subOrders.assignedVendor subOrders.price'));
  const mine = names && new Set(names);
  let count = 0;
  let netSalesPaise = 0;
  for (const order of orders) {
    if (order.status === 'Cancelled') continue;
    count += 1;
    if (!mine) {
      netSalesPaise += Math.round(Number(order.total || 0) * 100);
      continue;
    }
    (order.subOrders || [])
      .filter((sub) => mine.has(String(sub.assignedVendor || '').toLowerCase()))
      .forEach((sub) => { netSalesPaise += Math.round(Number(sub.price || 0) * 100); });
  }
  return successResponse(res, { orders: count, netSalesPaise }, 'Reports');
}

module.exports = { matchSettlement, matchReturnFile, matchCourierBill, salesReport };
