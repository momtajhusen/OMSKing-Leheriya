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

/** Each returned unit is priced from the order line it came from; two lines with one SKU keep their own prices. */
function returnAmount(row, order) {
  const left = (order?.items || []).map((item) => ({
    sku: item.sku, pricePaise: Math.round((Number(item.price) || 0) * 100), qty: Math.max(0, Number(item.qty) || 1),
  }));
  const paise = (row.items || []).reduce((sum, item) => {
    let want = Math.max(0, Number(item.qty) || 1);
    let value = 0;
    for (const line of left) {
      if (!want) break;
      if (line.sku !== item.sku || !line.qty) continue;
      const take = Math.min(want, line.qty);
      value += take * line.pricePaise;
      line.qty -= take;
      want -= take;
    }
    return sum + value;
  }, 0);
  return paise / 100;
}

async function listReturns(tenantId) {
  const [rows, bySku] = await Promise.all([
    skip(CustomerReturn.find({ tenantId }).sort({ createdAt: -1 })),
    imagesBySku(tenantId),
  ]);
  const orderNos = [...new Set(rows.map((row) => row.orderNo).filter(Boolean))];
  const orders = orderNos.length
    ? await skip(Order.find({ tenantId, orderNo: { $in: orderNos } }).select('orderNo items.sku items.price items.qty').lean())
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

const RECEIVE_LOCK_MS = 5 * 60 * 1000;

async function restockAgainstOrder(tenantId, userId, order, { items, referenceId, reason, destination, warehouseCode }) {
  const { restockRoom, capToRoom } = require('./orderReserve.service');
  const room = order ? await restockRoom(tenantId, order, [referenceId]) : new Map();
  const capped = await capToRoom(tenantId, items, room);
  if (capped.unmapped.length) {
    throw new HttpError(400, `Map ${capped.unmapped.join(', ')} on SKU Mapping before restocking this return.`);
  }
  if (!capped.items.length) return { warehouse: '', channels: [], posted: [], skipped: [], nothingLeft: true };
  return restockReturn(tenantId, userId, {
    items: capped.items, referenceId, reason, destination, warehouseCode, movementType: 'return_restock',
  });
}

async function receiveReturn(tenantId, userId, returnNo, { destination = 'All', action = 'restock', qcNote = '' } = {}) {
  const found = await skip(CustomerReturn.findOne({ tenantId, returnNo }));
  if (!found) throw new HttpError(404, 'Return not found');
  if (found.status === 'Completed') return { row: found, restock: null };
  if (found.status === 'Pending') throw new HttpError(400, 'Approve the return before receiving it');
  if (found.status !== 'Approved') throw new HttpError(400, 'This return was rejected and cannot be received');
  const now = new Date();
  const row = await skip(CustomerReturn.findOneAndUpdate(
    { tenantId, returnNo, status: 'Approved', $or: [{ receivingAt: null }, { receivingAt: { $lt: new Date(now.getTime() - RECEIVE_LOCK_MS) } }] },
    { $set: { receivingAt: now } },
    { new: true },
  ));
  if (!row) {
    const fresh = await skip(CustomerReturn.findOne({ tenantId, returnNo }));
    if (fresh?.status === 'Completed') return { row: fresh, restock: null };
    throw new HttpError(409, 'This return is already being received');
  }
  let restock = null;
  try {
    if (action === 'restock' && String(destination).toLowerCase() !== 'none') {
      const order = row.orderNo ? await skip(Order.findOne({ tenantId, orderNo: row.orderNo })) : null;
      restock = await restockAgainstOrder(tenantId, userId, order, {
        items: row.items, referenceId: row.returnNo, reason: `Return ${row.returnNo} received`, destination,
      });
    }
  } catch (err) {
    await skip(CustomerReturn.updateOne({ tenantId, returnNo, receivingAt: now }, { $set: { receivingAt: null } }));
    throw err;
  }
  row.receivingAt = null;
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
  if (row.refundStatus === 'refunded' && status !== 'refunded') throw new HttpError(400, 'This return is already refunded.');
  if (amount !== undefined || status === 'refunded') {
    const value = amount !== undefined ? Math.max(0, Number(amount) || 0) : Number(row.refundAmount) || 0;
    const order = row.orderNo ? await skip(Order.findOne({ tenantId, orderNo: row.orderNo }).lean()) : null;
    const orderTotal = returnAmount({ items: order?.items || [] }, order);
    if (orderTotal > 0) {
      const others = await skip(CustomerReturn.find({
        tenantId, orderNo: row.orderNo, returnNo: { $ne: returnNo }, refundStatus: { $ne: 'rejected' }, status: { $ne: 'Rejected' },
      }).lean());
      const promisedPaise = others.reduce((sum, other) => sum + Math.round((Number(other.refundAmount) || 0) * 100), 0);
      const limit = Math.max(0, Math.min(returnAmount(row, order), (Math.round(orderTotal * 100) - promisedPaise) / 100));
      if (value > limit) throw new HttpError(400, `Refund can't be more than ₹${limit} for this return.`);
    }
    if (amount !== undefined) row.refundAmount = value;
  }
  row.refundStatus = status;
  await row.save();
  return row;
}

/** Manual restock from the RTO and reverse-pickup screens: always tied to an order and capped by what left. */
async function restockOrderReturn(tenantId, userId, { orderNo, referenceId, items, destination, movementType, warehouseCode, reason } = {}) {
  const no = String(orderNo || '').trim();
  if (!no) throw new HttpError(400, 'Pick the order this restock belongs to.');
  const order = await skip(Order.findOne({ tenantId, orderNo: no }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (movementType === 'rto_restock') {
    const { restockRtoOnce } = require('./orderReserve.service');
    const result = await restockRtoOnce(tenantId, order, { destination: destination || 'All', userId });
    return result || { warehouse: '', channels: [], posted: [], skipped: [], nothingLeft: true };
  }
  const ref = String(referenceId || '').trim() || no;
  if (await skip(CustomerReturn.exists({ tenantId, returnNo: ref }))) {
    throw new HttpError(400, 'Receive this return from the Returns page.');
  }
  return restockAgainstOrder(tenantId, userId, order, {
    items: Array.isArray(items) ? items : [], referenceId: ref, reason: reason || `Return ${ref} received`, destination, warehouseCode,
  });
}

module.exports = {
  updateClaim,
  updateRefund,
  ingestReturns,
  listReturns,
  approveReturn,
  receiveReturn,
  restockOrderReturn,
};
