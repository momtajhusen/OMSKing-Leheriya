const mongoose = require('mongoose');
const Order = require('../models/Order');
const MasterSku = require('../models/MasterSku');
const CustomerReturn = require('../models/CustomerReturn');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
const { pageOf } = require('../utils/page');
const { merchantTenant } = require('./products.controller');
const { toOrderDto } = require('../lib/orderDto');
const { imagesBySku, imageForSku, paintOrder } = require('../lib/catalogImages');
const { applyDeskRules, stockPools, OPEN } = require('../services/orderDesk.service');
const { buildOrderSummary, customRange, dayKey } = require('../services/orderSummary.service');
const { vendorContact, labelHtml, invoiceHtml, deliveryStatusFor, escapeHtml } = require('../lib/orderSubOrders');
const { vendorByName, scopedVendorNames } = require('./vendors.controller');
const { recordFromReq } = require('../services/auditLog.service');
const { customerHistory } = require('../services/customerHistory.service');

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
  const allowed = new Set(names.map((name) => String(name).toLowerCase()));
  const subOrders = (dto.subOrders || []).filter((sub) => allowed.has(String(sub.assignedVendor || '').toLowerCase()));
  const skus = new Set(subOrders.map((sub) => sub.sku));
  const visible = [...new Set(subOrders.map((sub) => sub.assignedVendor).filter(Boolean))];
  const shopify = String(dto.shopifyVendor || '');
  const shopifyVisible = visible.some((name) => name.toLowerCase() === shopify.toLowerCase());
  return {
    ...dto,
    email: '',
    phone: '',
    assignedVendor: visible.join(', '),
    shopifyVendor: shopifyVisible ? dto.shopifyVendor : '',
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
  return Order.find(filter)
    .select('-sourceOrderData')
    .sort({ orderDate: -1, createdAt: -1 })
    .lean()
    .setOptions({ skipTenantFilter: true });
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

async function deskOrders(tenantId, docs) {
  const pools = await stockPools(tenantId);
  return applyDeskRules((docs || []).map((doc) => toOrderDto(doc)), pools);
}

function imageKeys(orders) {
  const keys = [];
  (orders || []).forEach((order) => {
    (order.items || []).forEach((item) => keys.push(item.sku, item.name));
    (order.subOrders || []).forEach((sub) => keys.push(sub.sku, sub.title));
    (order.channelLines || []).forEach((line) => keys.push(line.sku));
  });
  return keys;
}

async function presentOrders(tenantId, orders) {
  const bySku = await imagesBySku(tenantId, imageKeys(orders));
  const painted = (orders || []).map((order) => paintOrder(order, bySku));
  return withScans(tenantId, painted);
}

async function decorateOrders(tenantId, docs) {
  return presentOrders(tenantId, await deskOrders(tenantId, docs));
}

async function decorateOne(tenantId, doc) {
  const target = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const open = await Order.find({
    tenantId,
    status: { $in: [...OPEN] },
  }).select('-sourceOrderData').lean().setOptions({ skipTenantFilter: true });
  const id = String(target._id);
  const rows = open.some((row) => String(row._id) === id)
    ? open.map((row) => (String(row._id) === id ? target : row))
    : [target, ...open];
  const desk = await deskOrders(tenantId, rows);
  const mine = desk.find((row) => row.id === target.orderNo) || desk[0];
  if (!mine) return toOrderDto(target);
  const [painted] = await presentOrders(tenantId, [mine]);
  return painted;
}

const SHIPPING_TABS = ['Pickup & Manifest', 'In Transit', 'Delivered', 'RTO'];
const ON_THE_WAY = ['Dispatched', 'In transit'];

function isRto(row) {
  const codes = `${row.channelStatus || ''} ${(row.channelLines || []).map((line) => line.status || '').join(' ')}`;
  return codes.toUpperCase().includes('RTO');
}

/** Booked OMSKing shipments with no courier scan yet are still waiting for pickup. */
async function awaitingPickup(tenantId, rows) {
  const orderNos = rows.filter((row) => ON_THE_WAY.includes(row.status)).map((row) => row.id);
  if (!orderNos.length) return new Set();
  const Shipment = require('../models/Shipment');
  const waiting = await Shipment.find({
    tenantId,
    orderNo: { $in: orderNos },
    status: 'booked',
    deliveryStatus: '',
  }).select('orderNo').lean().setOptions({ skipTenantFilter: true });
  return new Set(waiting.map((row) => row.orderNo));
}

function shippingTab(row, waiting) {
  if (isRto(row)) return 'RTO';
  if (row.status === 'Delivered') return 'Delivered';
  if (ON_THE_WAY.includes(row.status)) return waiting.has(row.id) ? 'Pickup & Manifest' : 'In Transit';
  return '';
}

async function listOrders(req, res) {
  const tenantId = merchantTenant(req);
  const names = await vendorNamesFor(req, tenantId);
  if (names && !names.length) {
    return paginatedResponse(res, [], 1, 25, 0, 'Orders', {
      counts: { total: 0, New: 0, Packed: 0, 'Ready to Ship': 0, Unfulfillable: 0, Ready: 0, ...Object.fromEntries(SHIPPING_TABS.map((tab) => [tab, 0])) },
    });
  }
  const rows = await loadOrders(tenantId, names);
  const data = (await deskOrders(tenantId, rows)).map((row) => scopeToVendor(row, names));
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
    Ready: scoped.filter((row) => row.orderReady).length,
  };
  const waiting = await awaitingPickup(tenantId, scoped);
  const tabOf = new Map(scoped.map((row) => [row.id, shippingTab(row, waiting)]));
  SHIPPING_TABS.forEach((tab) => {
    counts[tab] = scoped.filter((row) => tabOf.get(row.id) === tab).length;
  });
  let filtered = scoped;
  const statuses = String(req.query.status || '').split(',').map((value) => value.trim()).filter((value) => value && value !== 'all');
  const channel = String(req.query.channel || '');
  const payment = String(req.query.payment || '');
  const source = String(req.query.source || '');
  const q = String(req.query.q || '').trim().toLowerCase();
  if (statuses.length) {
    filtered = filtered.filter((row) => statuses.some((status) => (SHIPPING_TABS.includes(status)
      ? tabOf.get(row.id) === status
      : row.status === status)));
  }
  if (channel && channel !== 'all') filtered = filtered.filter((row) => row.channel === channel);
  if (payment && payment !== 'all') {
    filtered = filtered.filter((row) => (payment === 'Partially Paid'
      ? row.paymentDetail === 'Partially paid'
      : row.paymentMode === payment));
  }
  if (source && source !== 'all') filtered = filtered.filter((row) => row.fulfilmentSource === source);
  const ready = String(req.query.ready || '');
  if (ready === 'ready') filtered = filtered.filter((row) => row.orderReady);
  if (ready === 'not_ready') filtered = filtered.filter((row) => !row.orderReady);
  const parcel = String(req.query.parcel || '');
  if (parcel && parcel !== 'all') {
    filtered = filtered.filter((row) => (row.subOrders || [])
      .some((sub) => sub.assignedVendor && sub.status !== 'Cancelled' && sub.vendorStatus === parcel));
  }
  const range = customRange(req.query.from, req.query.to);
  if (range) {
    filtered = filtered.filter((row) => {
      const key = dayKey(row.createdAt, req.query.tzOffset);
      return key && (!range.from || key >= range.from) && (!range.to || key <= range.to);
    });
  }
  if (q) {
    filtered = filtered.filter((row) => row.id.toLowerCase().includes(q)
      || String(row.channelOrderNo || '').toLowerCase().includes(q)
      || (row.subOrders || []).some((sub) => String(sub.id || '').toLowerCase().includes(q))
      || String(row.customer || '').toLowerCase().includes(q));
  }
  const paged = pageOf(filtered, req.query);
  const presented = await presentOrders(tenantId, paged.rows);
  return paginatedResponse(res, presented, paged.page, paged.limit, paged.total, 'Orders', { counts });
}

async function orderSummary(req, res) {
  const tenantId = merchantTenant(req);
  const names = await vendorNamesFor(req, tenantId);
  const empty = buildOrderSummary([], {
    channel: req.query.channel || 'all',
    days: req.query.days || 'all',
    from: req.query.from,
    to: req.query.to,
    tzOffset: req.query.tzOffset,
  });
  if (names && !names.length) return successResponse(res, empty, 'Order summary');
  const rows = await loadOrders(tenantId, names);
  let data = (await deskOrders(tenantId, rows)).map((row) => scopeToVendor(row, names));
  if (req.query.connected != null && String(req.query.connected) !== '') {
    const allowed = new Set(String(req.query.connected).split(',').map((name) => name.trim()).filter(Boolean));
    data = data.filter((row) => allowed.has(row.channel));
  }
  const ids = String(req.query.channelIds || '').split(',').map((item) => item.trim()).filter(Boolean);
  const labels = String(req.query.channelLabels || '').split(',').map((item) => item.trim()).filter(Boolean);
  const series = ids.map((id, index) => ({ id, label: labels[index] || id }));
  const returnRows = await CustomerReturn.find({ tenantId }).select('orderNo status').setOptions({ skipTenantFilter: true }).lean();
  const settledRows = await Order.find({
    tenantId,
    channel: 'Shopify',
    'sourceOrderData.financial_status': { $in: ['paid', 'voided'] },
  }).select('orderNo').setOptions({ skipTenantFilter: true }).lean();
  const summary = buildOrderSummary(data, {
    returnRows: returnRows.map((row) => ({ orderNo: row.orderNo, status: row.status })),
    settledOrderNos: settledRows.map((row) => row.orderNo),
    channel: req.query.channel || 'all',
    days: req.query.days || 'all',
    from: req.query.from,
    to: req.query.to,
    series,
    tzOffset: req.query.tzOffset,
  });
  const bySku = await imagesBySku(tenantId, summary.top.flatMap((row) => [row.sku, row.name]));
  summary.top = summary.top.map((row) => ({
    ...row,
    imageUrl: row.imageUrl || imageForSku(bySku, row.sku) || imageForSku(bySku, row.name) || '',
  }));
  return successResponse(res, summary, 'Order summary');
}

async function withBarcodes(tenantId, dto) {
  const items = dto.items || [];
  if (!items.length) return dto;
  const ids = items.map((item) => item.masterSkuId).filter((id) => mongoose.isValidObjectId(id));
  const codes = items.map((item) => String(item.sku || '').trim().toUpperCase()).filter(Boolean);
  const masters = await MasterSku.find({ tenantId, $or: [{ _id: { $in: ids } }, { code: { $in: codes } }] })
    .select('code barcode').lean().setOptions({ skipTenantFilter: true });
  const byId = new Map(masters.map((m) => [String(m._id), m.barcode || '']));
  const byCode = new Map(masters.map((m) => [m.code, m.barcode || '']));
  dto.items = items.map((item) => ({
    ...item,
    barcode: byId.get(item.masterSkuId) || byCode.get(String(item.sku || '').trim().toUpperCase()) || '',
  }));
  return dto;
}

async function getOrder(req, res) {
  const tenantId = merchantTenant(req);
  const names = await vendorNamesFor(req, tenantId);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const dto = scopeToVendor(await decorateOne(tenantId, order), names);
  if (names && !dto.subOrders.length) throw new HttpError(404, 'Order not found');
  return successResponse(res, await withPackages(tenantId, await withBarcodes(tenantId, await withAssignNotices(tenantId, dto))), 'Order');
}

/** Per sub-order: 'sent' when a vendor assignment message went out, 'failed' when every send failed. */
async function withAssignNotices(tenantId, dto) {
  const NotificationDelivery = require('../models/NotificationDelivery');
  const prefix = `vendor.assigned:${dto.id}:`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = await NotificationDelivery.find({ tenantId, dedupeKey: new RegExp(`^${prefix}`) })
    .select('dedupeKey status').setOptions({ skipTenantFilter: true }).lean();
  const noticeOf = (sub) => {
    const vendorKey = String(sub.assignedVendor || '').trim().toLowerCase();
    const mine = rows.filter((row) => row.dedupeKey === `vendor.assigned:${dto.id}:${sub.id}:${vendorKey}`);
    if (mine.some((row) => row.status === 'sent')) return 'sent';
    if (mine.some((row) => row.status === 'failed')) return 'failed';
    return '';
  };
  return { ...dto, subOrders: (dto.subOrders || []).map((sub) => ({ ...sub, assignNotice: sub.assignedVendor ? noticeOf(sub) : '' })) };
}

async function withPackages(tenantId, dto) {
  const { itemPackages } = require('../services/packageDefaults.service');
  const packs = await itemPackages(tenantId, dto.items || []);
  return { ...dto, items: (dto.items || []).map((item, index) => ({ ...item, package: packs[index] })) };
}

async function getCustomerHistory(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  return successResponse(res, await customerHistory(tenantId, order), 'Customer history');
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
  const { bookShopify, bookOtherCourier } = require('../services/ship.service');
  const courier = String(req.body?.courier || 'delhivery');
  if (courier === 'delhivery') await bookShopify(tenantId, order.orderNo);
  else await bookOtherCourier(tenantId, order.orderNo, { courier, awb: req.body?.awb });
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

async function fillLineTax(tenantId, order) {
  const open = (order.items || []).filter((item) => !Number(item.gst) || !item.hsn);
  if (!open.length) return;
  const MasterSku = require('../models/MasterSku');
  const Product = require('../models/Product');
  const ids = open.map((item) => item.masterSkuId).filter(Boolean);
  const codes = open.map((item) => String(item.sku || '').trim().toUpperCase()).filter(Boolean);
  const masters = await MasterSku.find({ tenantId, $or: [{ _id: { $in: ids } }, { code: { $in: codes } }] })
    .select('code hsnCode gstRatePercent productId').setOptions({ skipTenantFilter: true }).lean();
  const productIds = masters.map((row) => row.productId).filter(Boolean);
  const products = productIds.length
    ? await Product.find({ tenantId, _id: { $in: productIds } }).select('hsnCode gstRatePercent').setOptions({ skipTenantFilter: true }).lean()
    : [];
  const productOf = new Map(products.map((row) => [String(row._id), row]));
  open.forEach((item) => {
    const master = masters.find((row) => String(row._id) === String(item.masterSkuId || ''))
      || masters.find((row) => row.code === String(item.sku || '').trim().toUpperCase());
    if (!master) return;
    const product = productOf.get(String(master.productId || '')) || {};
    if (!Number(item.gst)) item.gst = Number(master.gstRatePercent) || Number(product.gstRatePercent) || 0;
    if (!item.hsn) item.hsn = master.hsnCode || product.hsnCode || '';
  });
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
  const { gstinState, sameState } = require('../services/finance.service');
  const gstin = String(tenant?.legalEntity?.gstin || '').trim();
  const registered = gstinState(gstin);
  if (registered && warehouseState && !sameState(registered, warehouseState)) {
    throw new HttpError(400, `Invoice not created. GSTIN ${gstin} is registered in ${registered}, but pickup warehouse WH-001 is in ${warehouseState}. Correct the GSTIN in Company Details or the state in Warehouses, then generate the invoice again.`);
  }
  if (req.body?.customerGstin !== undefined) {
    const customerGstin = String(req.body.customerGstin || '').replace(/\s+/g, '').toUpperCase();
    if (customerGstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(customerGstin)) {
      throw new HttpError(400, 'Customer GSTIN is not valid. It has 15 characters, like 07AAQCP4784P1ZB.');
    }
    order.customerGstin = customerGstin;
  }
  await fillLineTax(tenantId, order);
  const kind = req.body?.kind === 'credit' ? 'credit' : 'invoice';
  const pdf = buildInvoicePdf(order.toObject(), {
    company: {
      companyName: tenant?.name || '',
      legalName: tenant?.legalEntity?.legalName || '',
      gstin: tenant?.legalEntity?.gstin || '',
      email: tenant?.legalEntity?.email || '',
      phone: tenant?.legalEntity?.phone || '',
      address: tenant?.legalEntity?.address || '',
      city: [tenant?.legalEntity?.city, tenant?.legalEntity?.district].filter(Boolean).join(', '),
      website: String(tenant?.settings?.storefrontUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    },
    warehouseState: warehouseState || registered,
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
    invoiceHtml: invoiceHtml(dto, { warehouseState: warehouseState || registered, kind }),
    invoicePdf: pdf.bytes.toString('base64'),
    invoiceEmail,
  }, invoiceEmail.emailed ? 'Invoice emailed' : 'Invoice PDF ready. Email was not sent.');
}

function lineMasterId(order, sub) {
  if (sub?.masterSkuId) return sub.masterSkuId;
  const item = (order.items || []).find((row) => row.sku === sub?.sku);
  return item?.masterSkuId || null;
}

async function assignSubOrder(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const sub = (order.subOrders || []).find((row) => row.id === req.params.subOrderId);
  if (!sub) throw new HttpError(404, 'Sub-order not found');
  if (!lineMasterId(order, sub)) throw new HttpError(400, 'Map the SKU before this line can go to a vendor.');
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

async function subOrderFor(req) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const sub = (order.subOrders || []).find((row) => row.id === req.params.subOrderId);
  if (!sub) throw new HttpError(404, 'Sub-order not found');
  return { tenantId, order, sub };
}

async function lineCost(req, res) {
  const { tenantId, order, sub } = await subOrderFor(req);
  const lineCostService = require('../services/lineCost.service');
  return successResponse(res, await lineCostService.readLineCost(tenantId, order, sub, lineMasterId(order, sub)));
}

async function saveLineCost(req, res) {
  const { tenantId, order, sub } = await subOrderFor(req);
  const lineCostService = require('../services/lineCost.service');
  const saved = await lineCostService.saveLineCost(tenantId, order, sub, lineMasterId(order, sub), req.body.cost);
  return successResponse(res, saved, saved.shopifyUpdated ? 'Cost saved and sent to Shopify' : 'Cost saved');
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
  if (['Packed', 'Ready to Ship'].includes(status) && (order.items || []).some((item) => !item.masterSkuId)) {
    throw new HttpError(400, 'Map the SKU before this order can be packed.');
  }
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

async function editOrderDetails(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const { editOrder } = require('../services/orderEdit.service');
  const result = await editOrder(tenantId, order, req.body || {});
  await recordFromReq(req, {
    tenantId,
    action: 'order.edited',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    before: result.before,
    after: { ...result.after, pushedToShopify: result.pushed },
  });
  const message = result.pushed ? 'Order updated here and on Shopify' : 'Order updated here only. It was not sent to Shopify.';
  return successResponse(res, await decorateOne(tenantId, result.order), message);
}

async function updateNotes(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const notes = String(req.body?.notes ?? '').trim();
  if (notes.length > 1000) throw new HttpError(400, 'Order notes can be at most 1000 characters');
  const before = { notes: order.notes || '' };
  order.notes = notes;
  await order.save();
  await recordFromReq(req, {
    tenantId,
    action: 'order.notes_updated',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    before,
    after: { notes },
  });
  return successResponse(res, await decorateOne(tenantId, order), 'Order notes saved');
}

async function updateItemPackage(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const index = Number(req.params.index);
  const item = Number.isInteger(index) ? order.items[index] : null;
  if (!item) throw new HttpError(404, 'Order item not found');
  if (order.awb) throw new HttpError(400, 'Label is already generated. Cancel the label to change weight or size.');
  const { itemPackInput, itemPackages } = require('../services/packageDefaults.service');
  const next = itemPackInput(req.body || {});
  const [before] = await itemPackages(tenantId, [item]);
  item.pack = next;
  order.markModified('items');
  await order.save();
  const [after] = await itemPackages(tenantId, [item]);
  await recordFromReq(req, {
    tenantId,
    action: 'order.package_updated',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    before: { item: index, sku: item.sku, ...before },
    after: { item: index, sku: item.sku, ...after },
  });
  return successResponse(res, await withPackages(tenantId, await decorateOne(tenantId, order)), 'Weight and size saved');
}

async function mapItemSku(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const { mapOrderItem } = require('../services/catalogMapping.service');
  const sku = String(req.body.sku || '').trim();
  const { master } = await mapOrderItem(tenantId, req.user?.id, order, sku, req.body.masterSkuCode);
  await recordFromReq(req, {
    tenantId,
    action: 'order.sku_mapped',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    after: { sku, masterSku: master.code },
  });
  const fresh = await findMaster(tenantId, order.orderNo);
  return successResponse(res, await decorateOne(tenantId, fresh), `${sku} mapped to ${master.code}`);
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

function manifestDay(raw) {
  const text = String(raw || '');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const start = new Date(`${day}T00:00:00+05:30`);
  if (Number.isNaN(start.getTime())) throw new HttpError(400, 'date must be YYYY-MM-DD');
  return { day, start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Read-only: no courier or pickup call. One manifest per courier for the day's Ready to Ship orders. */
async function courierManifests(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const { day, start, end } = manifestDay(req.query.date);
  const rows = await deskOrders(tenantId, await loadOrders(tenantId));
  const labelledToday = (row) => {
    const at = row.labelGeneratedAt ? new Date(row.labelGeneratedAt).getTime() : NaN;
    return at >= start.getTime() && at < end.getTime();
  };
  const ready = rows.filter((row) => row.status === 'Ready to Ship');
  const picked = rows.filter((row) => row.awb
    && (row.status === 'Ready to Ship' || (ON_THE_WAY.includes(row.status) && labelledToday(row))));
  const byCourier = new Map();
  picked.forEach((row) => {
    const courier = String(row.courier || '').trim() || 'Other';
    if (!byCourier.has(courier)) byCourier.set(courier, []);
    const cod = row.paymentMode === 'COD' ? Number(row.total) || 0 : 0;
    byCourier.get(courier).push({
      orderNo: row.orderNo,
      channel: row.channel,
      channelOrderNo: row.channelOrderNo || '',
      awb: row.awb,
      customer: row.customer || '',
      city: row.city || '',
      paymentMode: row.paymentMode || '',
      codAmount: cod,
      qty: (row.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0),
    });
  });
  const stamp = day.replace(/-/g, '');
  const manifests = [...byCourier.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([courier, list]) => ({
      manifestId: `MF-${stamp}-${courier.toUpperCase().replace(/[^A-Z0-9]+/g, '')}`,
      courier,
      date: day,
      count: list.length,
      codTotal: list.reduce((sum, row) => sum + row.codAmount, 0),
      rows: list,
    }));
  return successResponse(res, {
    date: day,
    manifests,
    withoutAwb: ready.filter((row) => !row.awb).length,
  }, `${manifests.length} courier manifest${manifests.length === 1 ? '' : 's'}`);
}

async function bookBulkLabels(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const { queueBulkLabels } = require('../services/ship.service');
  const job = await queueBulkLabels(tenantId, req.user?._id || req.user?.id, req.body.orderIds || req.body.orderNos);
  return successResponse(res, { jobId: String(job._id), jobType: job.jobType }, 'One label job queued for these orders');
}

module.exports = {
  listOrders, orderSummary, getOrder, getCustomerHistory, generateLabel, cancelLabel, generateInvoice, markPaid, assignSubOrder, lineCost, saveLineCost, vendorUpdate, patchStatus, editOrderDetails, updateNotes, updateItemPackage, mapItemSku, bookReverse, bookBulkLabels, shipOrder, closeManifest, courierManifests, shippingReadiness,
};
