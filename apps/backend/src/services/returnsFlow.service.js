const Order = require('../models/Order');
const CustomerReturn = require('../models/CustomerReturn');
const { HttpError } = require('../utils/httpError');
const { restockReturn } = require('./inventory.service');
const { imagesBySku, imageForSku } = require('../lib/catalogImages');

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

async function ingestReturns(tenantId, rows = []) {
  const before = await Order.countDocuments({ tenantId });
  const saved = [];
  for (const row of rows) {
    const orderNo = String(row.orderNo || '').trim();
    const returnNo = String(row.returnNo || '').trim();
    if (!orderNo || !returnNo) continue;
    const order = await skip(Order.findOne({ tenantId, orderNo }));
    if (!order) continue;
    const existing = await skip(CustomerReturn.findOne({ tenantId, returnNo }));
    if (existing) {
      saved.push(existing);
      continue;
    }
    saved.push(await CustomerReturn.create({
      tenantId,
      returnNo,
      orderNo,
      channel: row.channel || order.channel,
      status: 'Pending',
      reason: row.reason || '',
      items: (row.items || order.items || []).map((item) => ({
        sku: item.sku || '',
        qty: item.qty || 1,
        name: item.name || '',
      })),
    }));
  }
  const after = await Order.countDocuments({ tenantId });
  return { saved: saved.length, createdOrder: after !== before };
}

function withReturnImage(item, bySku) {
  const plain = item?.toObject ? item.toObject() : { ...item };
  const imageUrl = plain.imageUrl || imageForSku(bySku, plain.sku) || imageForSku(bySku, plain.name);
  return imageUrl ? { ...plain, imageUrl } : plain;
}

async function listReturns(tenantId) {
  const [rows, bySku] = await Promise.all([
    skip(CustomerReturn.find({ tenantId }).sort({ createdAt: -1 })),
    imagesBySku(tenantId),
  ]);
  return rows.map((row) => ({
    id: row.returnNo,
    orderId: row.orderNo,
    reason: row.reason,
    status: row.status,
    type: 'customer_return',
    channel: row.channel,
    items: (row.items || []).map((item) => withReturnImage(item, bySku)),
    restockDestination: row.restockDestination,
    awb: row.labelAwb,
    labelGeneratedAt: row.status === 'Approved' || row.status === 'Completed' ? row.updatedAt : null,
    requestDate: row.createdAt,
  }));
}

function pinOf(order) {
  return `${order?.city || ''} ${order?.address || ''}`.match(/\b(\d{6})\b/)?.[1] || '';
}

async function returnLabelAwb(tenantId, row, deps = {}) {
  const { activeCourierCreds } = require('./courierAccount.service');
  const creds = deps.delhiveryCreds || await activeCourierCreds(tenantId, 'delhivery');
  const token = String(creds?.apiToken || creds?.token || '').trim();
  const warehouse = String(creds?.pickupWarehouse || '').trim();
  const order = await skip(Order.findOne({ tenantId, orderNo: row.orderNo }));
  const pin = pinOf(order);
  if (!token || !warehouse || !pin) return row.labelAwb || `RET-${row.returnNo}`;
  const delhivery = require('../adapters/couriers/delhivery');
  const booked = await delhivery.bookReturn(creds, {
    name: 'Return',
    address: order.address || 'Return pickup',
    pincode: pin,
    city: order.city,
    state: order.shipState || '',
    phone: order.phone || '0000000000',
    orderNo: row.returnNo,
    description: (row.items || []).map((item) => item.sku).filter(Boolean).join(', ') || 'Return',
    quantity: (row.items || []).reduce((sum, item) => sum + (Number(item.qty) || 1), 0) || 1,
    amount: 0,
    pickupAddress: order.address || '',
  }, { request: deps.delhiveryRequest });
  return booked.awb;
}

async function approveReturn(tenantId, returnNo, deps = {}) {
  const row = await skip(CustomerReturn.findOne({ tenantId, returnNo }));
  if (!row) throw new HttpError(404, 'Return not found');
  if (row.status === 'Pending') {
    row.status = 'Approved';
    row.labelAwb = await returnLabelAwb(tenantId, row, deps);
    await row.save();
  }
  return row;
}

async function receiveReturn(tenantId, userId, returnNo, { destination = 'All', action = 'restock' } = {}) {
  const row = await skip(CustomerReturn.findOne({ tenantId, returnNo }));
  if (!row) throw new HttpError(404, 'Return not found');
  if (row.status === 'Pending') throw new HttpError(400, 'Approve the return before receiving it');
  let restock = null;
  if (action === 'restock' && String(destination).toLowerCase() !== 'none') {
    restock = await restockReturn(tenantId, userId, {
      items: row.items,
      referenceId: row.returnNo,
      reason: `Return ${row.returnNo} received`,
      destination,
      movementType: 'return_restock',
    });
  }
  row.status = 'Completed';
  row.restockDestination = destination;
  await row.save();
  const { notifyEventEmail } = require('./notify.service');
  await notifyEventEmail(tenantId, 'NOT-006', {
    dedupeKey: `return:${row.returnNo}`,
    subject: `Return ${row.returnNo}`,
    text: `Return: ${row.returnNo}\nOrder: ${row.orderNo || ''}`,
  });
  return { row, restock };
}

module.exports = {
  ingestReturns,
  listReturns,
  approveReturn,
  receiveReturn,
};
