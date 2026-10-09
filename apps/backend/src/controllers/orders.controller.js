const Order = require('../models/Order');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
const { merchantTenant } = require('./products.controller');
const { toOrderDto } = require('../lib/orderDto');
const { imagesBySku, paintOrder } = require('../lib/catalogImages');
const { applyDeskRules, stockPools } = require('../services/orderDesk.service');
const { vendorContact, labelHtml, invoiceHtml, deliveryStatusFor, escapeHtml } = require('../lib/orderSubOrders');
const { vendorByName, scopedVendorNames } = require('./vendors.controller');
const { recordFromReq } = require('../services/auditLog.service');

function nextProcessing(status) {
  if (status === 'New' || status === 'Pending') return 'Processing';
  return status;
}

/** Vendor users only see orders (and sub-orders) assigned to their vendors. */
async function vendorNamesFor(req, tenantId) {
  if (!req.vendorScope?.active) return null;
  const names = await scopedVendorNames(tenantId, req.vendorScope.assignedVendorIds);
  return names.map((n) => n.toLowerCase());
}

function scopeToVendor(dto, names) {
  if (!names) return dto;
  const subOrders = (dto.subOrders || []).filter((sub) => names.includes(String(sub.assignedVendor || '').toLowerCase()));
  const skus = new Set(subOrders.map((sub) => sub.sku));
  return {
    ...dto,
    email: '',
    phone: '',
    subOrders,
    items: (dto.items || []).filter((item) => skus.has(item.sku)),
    total: subOrders.reduce((sum, sub) => sum + (Number(sub.price) || 0), 0),
  };
}

async function loadOrders(tenantId, vendorNames = null) {
  const filter = { tenantId };
  if (vendorNames) {
    filter['subOrders.assignedVendor'] = { $in: vendorNames.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) };
  }
  return Order.find(filter).sort({ orderDate: -1, createdAt: -1 }).setOptions({ skipTenantFilter: true });
}

async function findMaster(tenantId, rawId) {
  const id = decodeURIComponent(String(rawId || ''));
  const order = await Order.findOne({
    tenantId,
    $or: [{ orderNo: id }, { 'subOrders.id': id }],
  }).setOptions({ skipTenantFilter: true });
  return order;
}

async function decorateOrders(tenantId, docs) {
  const [pools, bySku] = await Promise.all([stockPools(tenantId), imagesBySku(tenantId)]);
  return applyDeskRules(docs.map((doc) => toOrderDto(doc)), pools).map((order) => paintOrder(order, bySku));
}

async function decorateOne(tenantId, doc) {
  const rows = await loadOrders(tenantId);
  const replaced = rows.some((row) => String(row._id) === String(doc._id))
    ? rows.map((row) => (String(row._id) === String(doc._id) ? doc : row))
    : [doc, ...rows];
  const decorated = await decorateOrders(tenantId, replaced);
  return decorated.find((row) => row.id === doc.orderNo) || decorated[0];
}

async function listOrders(req, res) {
  const tenantId = merchantTenant(req);
  const names = await vendorNamesFor(req, tenantId);
  if (names && !names.length) return paginatedResponse(res, [], 1, 50, 0, 'Orders');
  const rows = await loadOrders(tenantId, names);
  const data = (await decorateOrders(tenantId, rows)).map((row) => scopeToVendor(row, names));
  return paginatedResponse(res, data, 1, data.length || 50, data.length, 'Orders');
}

async function getOrder(req, res) {
  const tenantId = merchantTenant(req);
  const names = await vendorNamesFor(req, tenantId);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const dto = scopeToVendor(await decorateOne(tenantId, order), names);
  if (names && !dto.subOrders.length) throw new HttpError(404, 'Order not found');
  return successResponse(res, dto, 'Order');
}

async function generateLabel(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.channel === 'Amazon' || order.channel === 'Myntra') {
    throw new HttpError(400, `${order.channel} uses the marketplace courier. Print the channel label instead of an OMS AWB.`);
  }
  const subOrderId = req.body?.subOrderId || req.query.subOrderId;
  const nextStatus = nextProcessing(order.status);
  // No courier API is wired yet: AWB/courier are only stored when the user enters them.
  if (req.body?.awb) order.awb = String(req.body.awb).trim();
  if (req.body?.courier) order.courier = String(req.body.courier).trim();
  order.status = nextStatus;
  order.labelGeneratedAt = new Date();
  (order.subOrders || []).forEach((sub) => {
    if (subOrderId && sub.id !== subOrderId) return;
    sub.status = nextProcessing(sub.status);
    sub.deliveryStatus = deliveryStatusFor(sub.status);
  });
  await order.save();
  const dto = await decorateOne(tenantId, order);
  return successResponse(res, {
    ...dto,
    labelHtml: labelHtml(dto, subOrderId),
  }, 'Label generated');
}

async function cancelLabel(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.channel === 'Amazon' || order.channel === 'Myntra') {
    throw new HttpError(400, `${order.channel} labels are cancelled in the seller panel.`);
  }
  if (!order.awb && !order.labelGeneratedAt) throw new HttpError(400, 'This order has no OMS label to cancel.');
  const before = { status: order.status, awb: order.awb || '' };
  order.awb = '';
  order.labelGeneratedAt = null;
  if (['Processing', 'Packed', 'Ready to Ship'].includes(order.status)) order.status = 'New';
  (order.subOrders || []).forEach((sub) => {
    if (['Processing', 'Packed', 'Ready to Ship'].includes(sub.status)) {
      sub.status = 'New';
      sub.deliveryStatus = deliveryStatusFor('New');
    }
  });
  await order.save();
  await recordFromReq(req, {
    tenantId,
    action: 'order.label_cancelled',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    before,
    after: { status: order.status, awb: '' },
  });
  return successResponse(res, await decorateOne(tenantId, order), 'Label cancelled. Order is unfulfilled and back to New. Shopify updates when that channel is connected.');
}

async function generateInvoice(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  order.invoiceNo = order.channel === 'Shopify' ? order.orderNo : `INV-${order.orderNo}`;
  order.invoiceGeneratedAt = new Date();
  await order.save();
  const dto = await decorateOne(tenantId, order);
  return successResponse(res, {
    ...dto,
    invoiceHtml: invoiceHtml(dto),
  }, 'Invoice generated');
}

async function assignSubOrder(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const sub = (order.subOrders || []).find((row) => row.id === req.params.subOrderId);
  if (!sub) throw new HttpError(404, 'Sub-order not found');
  const vendorName = String(req.body.assignedVendor || '').trim();
  const saved = await vendorByName(tenantId, vendorName);
  if (vendorName && !saved) throw new HttpError(400, `${vendorName} is not a vendor on this workspace. Add it on the Vendors page first.`);
  const contact = vendorContact(saved?.name || vendorName, { ...(saved ? saved.toObject() : {}), ...req.body });
  sub.assignedVendor = contact.assignedVendor;
  sub.vendorPhone = contact.vendorPhone;
  sub.vendorEmail = contact.vendorEmail;
  sub.vendorLocation = contact.vendorLocation;
  sub.assignedDate = vendorName ? (req.body.assignedDate || new Date().toISOString().slice(0, 10)) : '';
  sub.vendorStatus = vendorName ? 'Pending Acceptance' : '';
  sub.rejectReason = '';
  sub.trackingNumber = '';
  sub.courier = '';
  sub.dispatchDate = '';
  sub.deliveredDate = '';
  if (req.body.price != null) sub.price = Number(req.body.price);
  const names = [...new Set((order.subOrders || []).map((row) => row.assignedVendor).filter(Boolean))];
  order.assignedVendor = names.length === 1 ? names[0] : names.join(', ');
  order.shopifyVendor = order.shopifyVendor || vendorName;
  if (order.fulfilmentSource !== 'Mixed') order.fulfilmentSource = 'Virtual';
  await order.save();
  return successResponse(res, await decorateOne(tenantId, order), 'Sub-order assigned');
}

const VENDOR_FLOW = {
  accept: { from: ['Pending Acceptance'], to: 'Accepted' },
  reject: { from: ['Pending Acceptance', 'Accepted'], to: 'Rejected' },
  ready: { from: ['Accepted'], to: 'Ready to Dispatch' },
  dispatch: { from: ['Accepted', 'Ready to Dispatch', 'Dispatched'], to: 'Dispatched' },
  deliver: { from: ['Dispatched'], to: 'Delivered' },
  save: { from: null, to: null },
};

const today = () => new Date().toISOString().slice(0, 10);

/** Vendor sheet actions on one assigned sub-order (vendor users: own lines only). */
async function vendorUpdate(req, res) {
  const tenantId = merchantTenant(req);
  const names = await vendorNamesFor(req, tenantId);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const sub = (order.subOrders || []).find((row) => row.id === req.params.subOrderId);
  if (!sub || !sub.assignedVendor) throw new HttpError(404, 'Sub-order not found');
  if (names && !names.includes(sub.assignedVendor.toLowerCase())) throw new HttpError(404, 'Sub-order not found');

  const action = String(req.body.action || 'save');
  const step = VENDOR_FLOW[action];
  if (!step) throw new HttpError(400, 'Unknown action');
  const current = sub.vendorStatus || 'Pending Acceptance';
  if (step.from && !step.from.includes(current)) {
    throw new HttpError(409, `Cannot ${action} a line that is ${current}`);
  }

  ['trackingNumber', 'courier', 'dispatchDate', 'deliveredDate'].forEach((key) => {
    if (req.body[key] != null) sub[key] = String(req.body[key]).trim();
  });
  if (req.body.price != null && !names) sub.price = Number(req.body.price);

  if (action === 'reject') {
    sub.rejectReason = String(req.body.reason || '').trim().slice(0, 300);
  }
  if (action === 'dispatch') {
    if (!sub.trackingNumber || !sub.courier) throw new HttpError(400, 'Tracking number and courier are required to dispatch');
    sub.dispatchDate = sub.dispatchDate || today();
    sub.status = 'Dispatched';
    sub.deliveryStatus = deliveryStatusFor('Dispatched');
  }
  if (action === 'deliver') {
    sub.deliveredDate = sub.deliveredDate || today();
    sub.status = 'Delivered';
    sub.deliveryStatus = deliveryStatusFor('Delivered');
  }
  if (step.to) sub.vendorStatus = step.to;

  if (order.source !== 'channel_api' && order.source !== 'channel_push') {
    const live = order.subOrders.filter((row) => row.status !== 'Cancelled');
    if (live.length && live.every((row) => row.status === 'Delivered')) order.status = 'Delivered';
    else if (live.length && live.every((row) => ['Dispatched', 'Delivered'].includes(row.status))) order.status = 'Dispatched';
  }
  await order.save();
  return successResponse(res, scopeToVendor(await decorateOne(tenantId, order), names), 'Line updated');
}

function staffOnly(req) {
  if (req.vendorScope?.active) throw new HttpError(403, 'Vendors cannot change this');
}

async function patchStatus(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const beforeStatus = order.status;
  const status = String(req.body.status || '').trim();
  const allowed = new Set(['New', 'Processing', 'Pending', 'Packed', 'Ready to Ship', 'Dispatched', 'Delivered', 'Cancelled', 'Unfulfillable']);
  if (!allowed.has(status)) throw new HttpError(400, 'Unknown status');
  order.status = status;
  (order.subOrders || []).forEach((sub) => {
    sub.status = status;
    sub.deliveryStatus = deliveryStatusFor(status);
  });
  await order.save();
  await recordFromReq(req, {
    tenantId,
    action: 'order.status_updated',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    before: { status: beforeStatus },
    after: { status: order.status },
  });
  return successResponse(res, await decorateOne(tenantId, order), 'Order status updated');
}

async function bookReverse(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status !== 'Delivered') {
    throw new HttpError(400, 'Mark the order delivered before booking reverse pickup');
  }
  const courier = String(req.body.courier || order.courier || '').trim();
  const reason = String(req.body.reason || 'Customer reverse pickup').trim();
  const returnId = order.reversePickup?.returnId || `RET-REV-${String(order.orderNo).replace(/-LEH$/i, '')}`;
  const awb = String(req.body.awb || order.reversePickup?.awb || '').trim();
  order.reversePickup = {
    returnId,
    awb,
    courier,
    reason,
    bookedAt: order.reversePickup?.bookedAt || new Date(),
  };
  await order.save();
  const dto = await decorateOne(tenantId, order);
  return successResponse(res, {
    ...dto,
    reverseLabelHtml: reversePickupHtml(dto),
  }, 'Reverse pickup booked');
}

function reversePickupHtml(order) {
  const pickup = order.reversePickup || {};
  const rows = (order.items || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.sku)}</td>
      <td>${item.qty}</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Reverse pickup ${escapeHtml(pickup.returnId || order.id)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 24px; }
    .box { border: 2px solid #111; padding: 20px; max-width: 440px; }
    .awb { font-size: 22px; letter-spacing: 0.12em; font-weight: 700; margin: 12px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    td { padding: 6px 0; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Reverse pickup label</h1>
    <div>Return <strong>${escapeHtml(pickup.returnId || '')}</strong></div>
    <div>Master order ${escapeHtml(order.id || order.orderNo)}</div>
    <div class="awb">${escapeHtml(pickup.awb || '')}</div>
    <div>${escapeHtml(order.customer)}<br/>${escapeHtml(order.address || order.city || '')}</div>
    <div style="margin-top:8px">${escapeHtml(pickup.courier || 'Courier')} · pickup from customer</div>
    <table>${rows}</table>
  </div>
</body>
</html>`;
}

module.exports = {
  listOrders, getOrder, generateLabel, cancelLabel, generateInvoice, assignSubOrder, vendorUpdate, patchStatus, bookReverse,
};
