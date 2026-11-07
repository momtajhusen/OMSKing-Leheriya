const Order = require('../models/Order');
const HandoverManifest = require('../models/HandoverManifest');
const { HttpError } = require('../utils/httpError');
const { warehouseResolver } = require('./channelWarehouse.service');
const { codCollectAmount } = require('../utils/payment');

const skip = (query) => query.setOptions({ skipTenantFilter: true });
const CLOSED = ['Delivered', 'Cancelled', 'Returned'];

function istDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function trackingOf(order) {
  return order.awb || (order.channelLines || []).find((line) => line.trackingNumber)?.trackingNumber || '';
}

function whyNot(order) {
  if (!order.labelGeneratedAt || !trackingOf(order)) return 'No label yet';
  if (order.handoverAt) return `Already on ${order.manifestNo || 'a manifest'}`;
  if (order.pickedUpAt) return 'Already picked up';
  if (CLOSED.includes(order.status)) return `Order is ${order.status}`;
  return '';
}

function manifestRow(order) {
  const pincode = (String(order.address || '').match(/\b\d{6}\b/g) || []).pop() || '';
  return {
    orderNo: order.orderNo,
    channelOrderNo: order.channelOrderNo || '',
    channel: order.channel || '',
    awb: trackingOf(order),
    customer: order.customer || '',
    city: order.city || '',
    pincode,
    paymentMode: order.paymentMode || '',
    codAmount: codCollectAmount(order),
    qty: (order.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0),
    weightKg: (order.items || []).reduce((sum, item) => sum + (Number(item.weightKg) || 0) * (Number(item.qty) || 1), 0),
  };
}

function view(doc) {
  const rows = doc.rows || [];
  return {
    manifestNo: doc.manifestNo,
    courier: doc.courier,
    warehouseCode: doc.warehouseCode,
    day: doc.day,
    createdAt: doc.createdAt,
    count: rows.length,
    codTotal: rows.reduce((sum, row) => sum + Math.round((Number(row.codAmount) || 0) * 100), 0) / 100,
    rows,
  };
}

async function nextNumber(tenantId, day, courier) {
  const prefix = `MF-${day.replace(/-/g, '')}-${courier.toUpperCase().replace(/[^A-Z0-9]+/g, '') || 'OTHER'}`;
  const taken = await skip(HandoverManifest.countDocuments({ tenantId, manifestNo: { $regex: `^${prefix}-` } }));
  return `${prefix}-${String(taken + 1).padStart(2, '0')}`;
}

/**
 * Moves labelled parcels to Ready to hand over and saves one manifest per courier and warehouse.
 * No courier is called: the pickup request stays a separate step.
 */
async function handOver(tenantId, userId, orderIds = []) {
  const ids = [...new Set((orderIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, 'Select the parcels to hand over');
  const orders = await skip(Order.find({ tenantId, orderNo: { $in: ids } }));
  const shipFrom = await warehouseResolver(tenantId);
  const skipped = ids.filter((id) => !orders.some((o) => o.orderNo === id)).map((orderNo) => ({ orderNo, reason: 'Order not found' }));
  const groups = new Map();
  for (const order of orders) {
    const reason = whyNot(order);
    if (reason) {
      skipped.push({ orderNo: order.orderNo, reason });
      continue;
    }
    const courier = String(order.courier || '').trim() || 'Other';
    const warehouseCode = shipFrom(order)?.code || '';
    const key = `${courier}|${warehouseCode}`;
    if (!groups.has(key)) groups.set(key, { courier, warehouseCode, orders: [] });
    groups.get(key).orders.push(order);
  }
  if (!groups.size) {
    throw new HttpError(400, `Nothing to hand over. ${skipped.map((row) => `${row.orderNo}: ${row.reason}`).join('; ')}`, skipped);
  }
  const day = istDay();
  const now = new Date();
  const manifests = [];
  for (const group of groups.values()) {
    const manifestNo = await nextNumber(tenantId, day, group.courier);
    const doc = await HandoverManifest.create({
      tenantId, manifestNo, courier: group.courier, warehouseCode: group.warehouseCode, day, rows: group.orders.map(manifestRow), createdBy: userId || null,
    });
    await skip(Order.updateMany(
      { tenantId, _id: { $in: group.orders.map((o) => o._id) } },
      { $set: { handoverAt: now, manifestNo } },
    ));
    manifests.push(view(doc.toObject()));
  }
  return { manifests, skipped };
}

async function listManifests(tenantId, { limit = 20 } = {}) {
  const rows = await skip(HandoverManifest.find({ tenantId }).sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 20, 1), 100))).lean();
  return rows.map(view);
}

async function getManifest(tenantId, manifestNo) {
  const doc = await skip(HandoverManifest.findOne({ tenantId, manifestNo: String(manifestNo || '') })).lean();
  if (!doc) throw new HttpError(404, 'Manifest not found');
  return view(doc);
}

module.exports = {
  handOver, listManifests, getManifest, manifestRow,
};
