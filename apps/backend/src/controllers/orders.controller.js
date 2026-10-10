const Order = require('../models/Order');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
const { pageOf } = require('../utils/page');
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
    subOrderIndexMap: Object.fromEntries(subOrders.map((sub) => [String(sub.index), sub.id])),
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

async function withScans(tenantId, orders) {
  if (!orders.length) return orders;
  const Shipment = require('../models/Shipment');
  const rows = await Shipment.find({
    tenantId,
    orderNo: { $in: orders.map((order) => order.id) },
    status: 'booked',
  }).select('orderNo deliveryStatus trackingEvents').setOptions({ skipTenantFilter: true });
  const byNo = new Map();
  rows.forEach((row) => {
    const events = row.trackingEvents || [];
    const last = events[events.length - 1];
    byNo.set(row.orderNo, {
      deliveryStatus: row.deliveryStatus || '',
      status: last?.status || '',
      detail: last?.detail || '',
      at: last?.at || null,
    });
  });
  return orders.map((order) => ({ ...order, trackingScan: byNo.get(order.id) || null }));
}

async function decorateOrders(tenantId, docs) {
  const [pools, bySku] = await Promise.all([stockPools(tenantId), imagesBySku(tenantId)]);
  const painted = applyDeskRules(docs.map((doc) => toOrderDto(doc)), pools).map((order) => paintOrder(order, bySku));
  return withScans(tenantId, painted);
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
  if (names && !names.length) return paginatedResponse(res, [], 1, 25, 0, 'Orders', { counts: { total: 0, New: 0, Packed: 0, 'Ready to Ship': 0, Unfulfillable: 0 } });
  const rows = await loadOrders(tenantId, names);
  const data = (await decorateOrders(tenantId, rows)).map((row) => scopeToVendor(row, names));
  let scoped = data;
  if (req.query.connected != null && String(req.query.connected) !== '') {
    const allowed = new Set(String(req.query.connected).split(',').map((name) => name.trim()).filter(Boolean));
    scoped = scoped.filter((row) => allowed.has(row.channel));
  }
  const counts = {
    total: scoped.length,
    New: scoped.filter((row) => row.status === 'New').length,
    Packed: scoped.filter((row) => row.status === 'Packed').length,
    'Ready to Ship': scoped.filter((row) => row.status === 'Ready to Ship').length,
    Unfulfillable: scoped.filter((row) => row.status === 'Unfulfillable').length,
  };
  let filtered = scoped;
  const status = String(req.query.status || '');
  const channel = String(req.query.channel || '');
  const payment = String(req.query.payment || '');
  const source = String(req.query.source || '');
  const q = String(req.query.q || '').trim().toLowerCase();
  if (status && status !== 'all') filtered = filtered.filter((row) => row.status === status);
  if (channel && channel !== 'all') filtered = filtered.filter((row) => row.channel === channel);
  if (payment && payment !== 'all') {
    filtered = filtered.filter((row) => (payment === 'Partially Paid'
      ? row.paymentDetail === 'Partially paid'
      : row.paymentMode === payment));
  }
  if (source && source !== 'all') filtered = filtered.filter((row) => row.fulfilmentSource === source);
  if (q) {
    filtered = filtered.filter((row) => row.id.toLowerCase().includes(q)
      || (row.subOrders || []).some((sub) => String(sub.id || '').toLowerCase().includes(q))
      || String(row.customer || '').toLowerCase().includes(q));
  }
  const paged = pageOf(filtered, req.query);
  return paginatedResponse(res, paged.rows, paged.page, paged.limit, paged.total, 'Orders', { counts });
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
    throw new HttpError(400, `${order.channel} uses the marketplace courier. Print the channel label instead of a Delhivery AWB.`);
  }
  const subOrderId = req.body?.subOrderId || req.query.subOrderId;
  const { bookShopify } = require('../services/ship.service');
  await bookShopify(tenantId, order.orderNo);
  const fresh = await findMaster(tenantId, order.orderNo);
  const dto = await decorateOne(tenantId, fresh);
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
  const before = { status: order.status, awb: order.awb || '' };
  const { cancelShopifyLabel } = require('../services/ship.service');
  await cancelShopifyLabel(tenantId, order.orderNo, { releaseReserve: false });
  const cancelled = await findMaster(tenantId, order.orderNo);
  await recordFromReq(req, {
    tenantId,
    action: 'order.label_cancelled',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    before,
    after: { status: cancelled.status, awb: '' },
  });
  return successResponse(res, await decorateOne(tenantId, cancelled), 'Label cancelled. Delhivery AWB is cancelled and Shopify is unfulfilled. The stock reserve stays until the order itself is cancelled.');
}

async function markPaid(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  order.paymentStatus = 'paid';
  await order.save();
  return successResponse(res, await decorateOne(tenantId, order), 'Payment marked. This order is paid.');
}

async function generateInvoice(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const Tenant = require('../models/Tenant');
  const Warehouse = require('../models/Warehouse');
  const { buildInvoicePdf, emailInvoicePdf } = require('../lib/invoicePdf');
  const { mailboxOf, sendMail } = require('../lib/mailer');
  const tenant = await Tenant.findById(tenantId).setOptions({ skipTenantFilter: true });
  const home = await Warehouse.findOne({ tenantId, code: 'WH-001' }).setOptions({ skipTenantFilter: true });
  const warehouseState = home?.address?.state || '';
  const kind = req.body?.kind === 'credit' ? 'credit' : 'invoice';
  const pdf = buildInvoicePdf(order.toObject(), {
    company: { companyName: tenant?.name || '', gstin: tenant?.legalEntity?.gstin || '' },
    warehouseState,
    kind,
  });
  order.invoiceNo = pdf.invoiceNo;
  order.invoiceGeneratedAt = new Date();
  await order.save();
  const invoiceEmail = req.body?.email === false
    ? { emailed: false, skipped: true, reason: 'not requested' }
    : await emailInvoicePdf({
      tenantId,
      to: order.email,
      pdf: pdf.bytes,
      filename: `${pdf.number || 'invoice'}.pdf`,
      subject: `${kind === 'credit' ? 'Credit note' : 'Tax invoice'} ${pdf.number}`,
      mailboxOf,
      sendMail,
    });
  const dto = await decorateOne(tenantId, order);
  return successResponse(res, {
    ...dto,
    invoiceHtml: invoiceHtml(dto, { warehouseState, kind }),
    invoicePdf: pdf.bytes.toString('base64'),
    invoiceEmail,
  }, invoiceEmail.emailed ? 'Invoice emailed' : 'Invoice PDF ready. Email was not sent.');
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
  let telegram = '';
  if (vendorName) {
    const { notifyVendorAssigned } = require('../services/notify.service');
    const note = await notifyVendorAssigned(tenantId, order, sub);
    telegram = note.reason || note.telegram;
  }
  return successResponse(res, await decorateOne(tenantId, order), 'Sub-order assigned', 200, telegram ? { telegram } : null);
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
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (!reason) throw new HttpError(400, 'Reject needs a reason');
    sub.rejectReason = reason;
    const { releaseVendorSlice } = require('../services/ship.service');
    const { clearVendorAssignNotice } = require('../services/notify.service');
    await releaseVendorSlice(tenantId, order, sub);
    await clearVendorAssignNotice(tenantId, order, sub);
    sub.assignedVendor = '';
    sub.vendorPhone = '';
    sub.vendorEmail = '';
    sub.vendorLocation = '';
    sub.assignedDate = '';
    sub.vendorStatus = '';
    const namesLeft = [...new Set((order.subOrders || []).map((row) => row.assignedVendor).filter(Boolean))];
    order.assignedVendor = namesLeft.join(', ');
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
  if (step.to && action !== 'reject') sub.vendorStatus = step.to;
  if (action === 'reject') sub.vendorStatus = '';

  if (order.source !== 'channel_api' && order.source !== 'channel_push') {
    const live = order.subOrders.filter((row) => row.status !== 'Cancelled');
    if (live.length && live.every((row) => row.status === 'Delivered')) order.status = 'Delivered';
    else if (live.length && live.every((row) => ['Dispatched', 'Delivered'].includes(row.status))) order.status = 'Dispatched';
  }
  await order.save();
  const { notifyEventEmail } = require('../services/notify.service');
  if (action === 'dispatch') {
    await notifyEventEmail(tenantId, 'NOT-003', {
      dedupeKey: `dispatch:${order.orderNo}:${sub.id}`,
      subject: `Dispatched ${order.orderNo}`,
      text: `Order: ${order.orderNo}\nSKU: ${sub.sku || '—'}\nQty: ${sub.qty || 1}`,
    }, req.notifyDeps);
  }
  if (action === 'deliver') {
    await notifyEventEmail(tenantId, 'NOT-005', {
      dedupeKey: `delivered:${order.orderNo}`,
      subject: `Delivered ${order.orderNo}`,
      text: `Order: ${order.orderNo}\nStatus: Delivered`,
    }, req.notifyDeps);
  }
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
  if (status === 'Cancelled') {
    const { releaseOrderReserve } = require('../services/ship.service');
    await releaseOrderReserve(tenantId, order);
  }
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

async function shippingReadiness(req, res) {
  const { shippingReadiness: readiness } = require('../services/ship.service');
  return successResponse(res, await readiness(merchantTenant(req)), 'Shipping readiness');
}

async function shipOrder(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.channel === 'Shopify') {
    throw new HttpError(400, 'Shopify ships on Delhivery. Use the label action.');
  }
  const { bookMarketplace } = require('../services/ship.service');
  await bookMarketplace(tenantId, order.orderNo);
  const fresh = await findMaster(tenantId, order.orderNo);
  return successResponse(res, await decorateOne(tenantId, fresh), `${order.channel} tracking saved. Delhivery was not called.`);
}

async function closeManifest(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const { closeDayManifest } = require('../services/ship.service');
  const manifest = await closeDayManifest(tenantId);
  return successResponse(res, manifest, `Pickup requested for ${manifest.count} AWB${manifest.count === 1 ? '' : 's'} at WH-001`);
}

async function bookBulkLabels(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const { queueBulkLabels } = require('../services/ship.service');
  const job = await queueBulkLabels(tenantId, req.user?._id || req.user?.id, req.body.orderIds || req.body.orderNos);
  return successResponse(res, { jobId: String(job._id), jobType: job.jobType }, 'One label job queued for these orders');
}

module.exports = {
  listOrders, getOrder, generateLabel, cancelLabel, generateInvoice, markPaid, assignSubOrder, vendorUpdate, patchStatus, bookReverse, bookBulkLabels, shipOrder, closeManifest, shippingReadiness,
};
