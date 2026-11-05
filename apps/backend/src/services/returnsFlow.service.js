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
    const externalOrderId = String(row.externalOrderId || '').trim();
    if ((!orderNo && !externalOrderId) || !returnNo) continue;
    const order = await skip(Order.findOne({
      tenantId,
      $or: [
        ...(orderNo ? [{ orderNo }] : []),
        ...(externalOrderId ? [{ externalOrderId }, { 'channelLines.sellerOrderId': externalOrderId }] : []),
      ],
    }));
    if (!order) continue;
    const existing = await skip(CustomerReturn.findOne({ tenantId, returnNo }));
    if (existing) {
      saved.push(existing);
      continue;
    }
    saved.push(await CustomerReturn.create({
      tenantId,
      returnNo,
      orderNo: order.orderNo,
      channel: row.channel || order.channel,
      status: 'Pending',
      reason: row.reason || '',
      kind: returnKind(row),
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

const RTO_HINT = /\bRTO\b|return to origin|undeliver/i;

function returnKind(row) {
  if (row.kind === 'rto' || row.kind === 'customer') return row.kind;
  return RTO_HINT.test(`${row.reason || ''} ${row.type || ''}`) ? 'rto' : 'customer';
}

/** Marketplace claim for a damaged return: Amazon = SAFE-T, Myntra = Myntra claim; other channels have none. */
function claimTypeOf(channel) {
  const name = String(channel || '').toLowerCase();
  if (name === 'amazon') return 'safet';
  if (name === 'myntra') return 'myntra';
  return '';
}

function claimView(row) {
  const claim = row.claim || {};
  return {
    type: claim.type || claimTypeOf(row.channel),
    status: claim.status || 'none',
    claimId: claim.claimId || '',
    amount: claim.amount || 0,
    note: claim.note || '',
  };
}

function withReturnImage(item, bySku) {
  const plain = item?.toObject ? item.toObject() : { ...item };
  const imageUrl = plain.imageUrl || imageForSku(bySku, plain.sku) || imageForSku(bySku, plain.name);
  return imageUrl ? { ...plain, imageUrl } : plain;
}

function returnAmount(row, order) {
  const priceBySku = new Map((order?.items || []).map((item) => [item.sku, Number(item.price) || 0]));
  return (row.items || []).reduce((sum, item) => sum + (priceBySku.get(item.sku) || 0) * (Number(item.qty) || 1), 0);
}

async function listReturns(tenantId) {
  const [rows, bySku] = await Promise.all([
    skip(CustomerReturn.find({ tenantId }).sort({ createdAt: -1 })),
    imagesBySku(tenantId),
  ]);
  const orderNos = [...new Set(rows.map((row) => row.orderNo).filter(Boolean))];
  const orders = orderNos.length
    ? await skip(Order.find({ tenantId, orderNo: { $in: orderNos } }).select('orderNo items.sku items.price').lean())
    : [];
  const orderByNo = new Map(orders.map((order) => [order.orderNo, order]));
  return rows.map((row) => ({
    amount: returnAmount(row, orderByNo.get(row.orderNo)),
    id: row.returnNo,
    orderId: row.orderNo,
    reason: row.reason,
    status: row.status,
    type: row.kind === 'rto' ? 'rto' : 'customer_return',
    kind: row.kind || 'customer',
    qcStatus: row.qcStatus || 'pending',
    qcNote: row.qcNote || '',
    refundStatus: row.refundStatus || 'pending',
    refundAmount: row.refundAmount || 0,
    claim: claimView(row),
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

async function receiveReturn(tenantId, userId, returnNo, { destination = 'All', action = 'restock', qcNote = '' } = {}) {
  const row = await skip(CustomerReturn.findOne({ tenantId, returnNo }));
  if (!row) throw new HttpError(404, 'Return not found');
  if (row.status === 'Pending') throw new HttpError(400, 'Approve the return before receiving it');
  if (row.status === 'Completed') return { row, restock: null };
  const order = row.orderNo ? await skip(Order.findOne({ tenantId, orderNo: row.orderNo })) : null;
  let restock = null;
  // RTO already put the piece back. A later Return Received must not add it again.
  if (!order?.rtoRestockedAt && action === 'restock' && String(destination).toLowerCase() !== 'none') {
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
  row.qcStatus = action === 'damaged' ? 'fail' : action === 'hold' ? 'hold' : 'pass';
  row.qcNote = String(qcNote || '').trim().slice(0, 500);
  const claimType = claimTypeOf(row.channel);
  if (row.qcStatus === 'fail' && claimType && (!row.claim?.status || row.claim.status === 'none')) {
    row.claim = { ...(row.claim?.toObject ? row.claim.toObject() : row.claim || {}), type: claimType, status: 'to_file' };
  }
  await row.save();
  const { notifyEventEmail } = require('./notify.service');
  await notifyEventEmail(tenantId, 'NOT-006', {
    dedupeKey: `return:${row.returnNo}`,
    subject: `Return ${row.returnNo}`,
    text: `Return: ${row.returnNo}\nOrder: ${row.orderNo || ''}`,
  });
  return { row, restock };
}

const CLAIM_STATUSES = ['none', 'to_file', 'filed', 'approved', 'rejected'];
const REFUND_STATUSES = ['not_due', 'pending', 'refunded', 'rejected'];

async function updateClaim(tenantId, returnNo, { status, claimId, amount, note } = {}) {
  const row = await skip(CustomerReturn.findOne({ tenantId, returnNo }));
  if (!row) throw new HttpError(404, 'Return not found');
  const type = claimTypeOf(row.channel);
  if (!type) throw new HttpError(400, 'Claims are only for Amazon (SAFE-T) and Myntra returns.');
  if (!CLAIM_STATUSES.includes(status)) throw new HttpError(400, 'Unknown claim status');
  const claim = row.claim?.toObject ? row.claim.toObject() : { ...(row.claim || {}) };
  if (claimId !== undefined) claim.claimId = String(claimId || '').trim().slice(0, 80);
  if (status === 'filed' && !claim.claimId) {
    throw new HttpError(400, `Enter the ${type === 'safet' ? 'SAFE-T claim ID' : 'Myntra claim ID'} from the portal.`);
  }
  if (amount !== undefined) claim.amount = Math.max(0, Number(amount) || 0);
  if (note !== undefined) claim.note = String(note || '').trim().slice(0, 500);
  if (status === 'filed' && !claim.filedAt) claim.filedAt = new Date();
  if (status === 'approved' || status === 'rejected') claim.settledAt = new Date();
  row.claim = { ...claim, type, status };
  await row.save();
  return row;
}

async function updateRefund(tenantId, returnNo, { status, amount } = {}) {
  const row = await skip(CustomerReturn.findOne({ tenantId, returnNo }));
  if (!row) throw new HttpError(404, 'Return not found');
  if (!REFUND_STATUSES.includes(status)) throw new HttpError(400, 'Unknown refund status');
  row.refundStatus = status;
  if (amount !== undefined) row.refundAmount = Math.max(0, Number(amount) || 0);
  await row.save();
  return row;
}

module.exports = {
  updateClaim,
  updateRefund,
  ingestReturns,
  listReturns,
  approveReturn,
  receiveReturn,
};
