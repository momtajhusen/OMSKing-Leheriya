const mongoose = require('mongoose');
const Order = require('../models/Order');
const MasterSku = require('../models/MasterSku');
const CustomerReturn = require('../models/CustomerReturn');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
const { pageOf } = require('../utils/page');
const { merchantTenant } = require('./products.controller');
const { toOrderDto } = require('../lib/orderDto');
const { warehouseResolver } = require('../services/channelWarehouse.service');
const { imagesBySku, imageForSku, paintOrder } = require('../lib/catalogImages');
const { applyDeskRules, stockPools, OPEN } = require('../services/orderDesk.service');
const { buildOrderSummary, customRange, dayKey } = require('../services/orderSummary.service');
const { SHIPPING_TABS, ON_THE_WAY, shippingTab } = require('../lib/orderTabs');
const { vendorContact, labelHtml, labelInvoiceHtml, invoiceHtml, deliveryStatusFor, escapeHtml } = require('../lib/orderSubOrders');
const { vendorByName, scopedVendorNames } = require('./vendors.controller');
const { recordFromReq } = require('../services/auditLog.service');
const { customerHistory } = require('../services/customerHistory.service');
const { codCollectAmount, isPaid } = require('../utils/payment');
const { tenantMemo, bustTenantMemo } = require('../lib/tenantMemo');

const DESK_TTL_MS = 8_000;

function nextProcessing(status) {
  if (status === 'New' || status === 'Pending') return 'Processing';
  return status;
}

/** Seed leftover "123 Fashion Street" must never print as Ship From / return address. */
function isSeedPickupAddress(line1) {
  return /123\s*fashion\s*street/i.test(String(line1 || '').trim());
}

async function packingSlipWarehouse(tenantId, warehouseCode) {
  const Warehouse = require('../models/Warehouse');
  const Tenant = require('../models/Tenant');
  const [wh, tenant] = await Promise.all([
    Warehouse.findOne({ tenantId, code: warehouseCode || 'WH-001', status: 'active' })
      .setOptions({ skipTenantFilter: true }).lean(),
    Tenant.findById(tenantId).select('name slug legalEntity settings.storefrontUrl').setOptions({ skipTenantFilter: true }).lean(),
  ]);
  const legal = tenant?.legalEntity || {};
  let line1 = String(wh?.address?.line1 || '').trim();
  let city = String(wh?.address?.city || '').trim();
  let state = String(wh?.address?.state || '').trim();
  let pincode = String(wh?.address?.pincode || '').trim();
  let phone = String(wh?.contactPhone || '').trim();
  let name = String(wh?.name || '').trim();
  if (!line1 || isSeedPickupAddress(line1)) {
    line1 = String(legal.address || '').trim() || line1;
    const district = String(legal.district || '');
    const pinMatch = `${district} ${legal.city || ''}`.match(/\b(\d{6})\b/);
    city = String(legal.city || '').replace(/\s*-\s*\d{6}.*$/, '').trim() || city;
    state = state || String(legal.state || '').trim();
    pincode = pincode || (pinMatch ? pinMatch[1] : '');
    phone = phone || String(legal.phone || '').replace(/\s+/g, '');
    name = name || String(legal.legalName || tenant?.name || '').trim();
  }
  const { logoDataUri } = require('../lib/companyLogo');
  const logoUrl = String(legal.logoUrl || '').trim();
  const brandName = String(legal.brandName || tenant?.name || '').trim();
  return {
    brandName,
    tenantName: tenant?.name || '',
    logoUrl,
    logoSrc: logoDataUri(logoUrl) || logoUrl,
    gstin: legal.gstin || '',
    companyGstin: legal.gstin || '',
    companyWebsite: legal.website || String(tenant?.settings?.storefrontUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    companyEmail: legal.email || '',
    companyPhone: legal.phone || '',
    companyName: String(tenant?.name || '').trim(),
    companyLegalName: String(legal.legalName || '').trim(),
    companyAddress: legal.address || '',
    companyCity: [legal.city, legal.district].filter(Boolean).join(', '),
    companyState: legal.state || '',
    warehouseName: name || legal.legalName || '',
    warehouseLine1: line1,
    warehouseCity: city,
    warehouseState: state,
    warehousePincode: pincode,
    warehousePhone: phone || legal.phone || '',
  };
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
    .select('-sourceOrderData.id -sourceOrderData.fulfillment_status -sourceOrderData.cancelled_at -sourceOrderData.location_id -sourceOrderData.gateways')
    .sort({ orderDate: -1, createdAt: -1 })
    .lean()
    .setOptions({ skipTenantFilter: true });
}

/** One short-lived desk snapshot per tenant — list + summary share the heavy loadOrders/deskOrders work. */
async function deskSnapshot(tenantId, vendorNames = null) {
  const scope = vendorNames ? vendorNames.map((name) => String(name).toLowerCase()).sort().join(',') : '*';
  return tenantMemo(`desk:${tenantId}:${scope}`, DESK_TTL_MS, async () => {
    const rows = await loadOrders(tenantId, vendorNames);
    return deskOrders(tenantId, rows);
  });
}

function bustOrderDesk(tenantId) {
  if (!tenantId) return;
  bustTenantMemo(`desk:${tenantId}`);
}

async function findMaster(tenantId, rawId) {
  const id = decodeURIComponent(String(rawId || ''));
  const bare = id.replace(/^#/, '');
  const order = await Order.findOne({
    tenantId,
    $or: [
      { orderNo: id },
      { 'subOrders.id': id },
      { channelOrderNo: id },
      { channelOrderNo: `#${bare}` },
      { channelOrderNo: bare },
    ],
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
  }).select({ orderNo: 1, deliveryStatus: 1, trackingEvents: { $slice: -1 } }).lean().setOptions({ skipTenantFilter: true });
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
  const [bySku, shipFrom] = await Promise.all([imagesBySku(tenantId, imageKeys(orders)), warehouseResolver(tenantId)]);
  const painted = (orders || []).map((order) => ({ ...paintOrder(order, bySku), shipWarehouse: shipFrom(order) }));
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

async function listOrders(req, res) {
  const tenantId = merchantTenant(req);
  const names = await vendorNamesFor(req, tenantId);
  if (names && !names.length) {
    return paginatedResponse(res, [], 1, 25, 0, 'Orders', {
      counts: { total: 0, New: 0, Packed: 0, 'Ready to Ship': 0, Unfulfillable: 0, Ready: 0, ...Object.fromEntries(SHIPPING_TABS.map((tab) => [tab, 0])) },
    });
  }
  const data = (await deskSnapshot(tenantId, names)).map((row) => scopeToVendor(row, names));
  let scoped = data;
  if (req.query.connected != null && String(req.query.connected) !== '') {
    const allowed = new Set(String(req.query.connected).split(',').map((name) => name.trim()).filter(Boolean));
    scoped = scoped.filter((row) => allowed.has(row.channel));
  }
  let filtered = scoped;
  const statuses = String(req.query.status || '').split(',').map((value) => value.trim()).filter((value) => value && value !== 'all');
  const channel = String(req.query.channel || '');
  const payment = String(req.query.payment || '');
  const source = String(req.query.source || '');
  const q = String(req.query.q || '').trim().toLowerCase();
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
  const counts = {
    total: filtered.length,
    New: filtered.filter((row) => row.status === 'New').length,
    Packed: filtered.filter((row) => row.status === 'Packed').length,
    'Ready to Ship': filtered.filter((row) => row.status === 'Ready to Ship').length,
    Unfulfillable: filtered.filter((row) => row.status === 'Unfulfillable').length,
    Ready: filtered.filter((row) => row.orderReady).length,
  };
  const waiting = await awaitingPickup(tenantId, filtered);
  const tabOf = new Map(filtered.map((row) => [row.id, shippingTab(row, waiting)]));
  SHIPPING_TABS.forEach((tab) => {
    counts[tab] = filtered.filter((row) => tabOf.get(row.id) === tab).length;
  });
  if (statuses.length) {
    filtered = filtered.filter((row) => statuses.some((status) => (SHIPPING_TABS.includes(status)
      ? tabOf.get(row.id) === status
      : row.status === status)));
  }
  const paged = pageOf(filtered, req.query);
  const presented = await presentOrders(tenantId, paged.rows);
  return paginatedResponse(res, presented, paged.page, paged.limit, paged.total, 'Orders', { counts });
}

/** Connected marketplace labels from DB — not the browser store (which can briefly miss Amazon/Myntra). */
async function connectedOrderSeries(tenantId) {
  const ChannelConnection = require('../models/ChannelConnection');
  const { channelById } = require('../channels/registry');
  const rows = await ChannelConnection.find({ tenantId }).setOptions({ skipTenantFilter: true });
  return rows
    .filter((row) => row.status === 'connected' || row.lastTestOk)
    .map((row) => {
      const id = String(row.channel || '').toLowerCase();
      const meta = channelById(id);
      const label = id === 'myntra' ? 'Myntra' : (meta?.name || id);
      return { id, label };
    });
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
  let data = (await deskSnapshot(tenantId, names)).map((row) => scopeToVendor(row, names));
  const serverSeries = await connectedOrderSeries(tenantId);
  if (req.query.connected != null && String(req.query.connected) !== '') {
    const connectedQ = String(req.query.connected).trim();
    if (connectedQ === '__none__' && !serverSeries.length) {
      data = [];
    } else {
      // Prefer DB-connected labels so a stale client list cannot hide Amazon/Myntra.
      const allowed = new Set(
        serverSeries.length
          ? serverSeries.map((entry) => entry.label)
          : connectedQ.split(',').map((name) => name.trim()).filter(Boolean),
      );
      data = data.filter((row) => allowed.has(row.channel));
    }
  }
  const ids = String(req.query.channelIds || '').split(',').map((item) => item.trim()).filter(Boolean);
  const labels = String(req.query.channelLabels || '').split(',').map((item) => item.trim()).filter(Boolean);
  const clientSeries = ids.map((id, index) => ({ id, label: labels[index] || id }));
  const series = serverSeries.length ? serverSeries : clientSeries;
  const returnRows = await CustomerReturn.find({ tenantId }).select('orderNo status refundStatus refundAmount').setOptions({ skipTenantFilter: true }).lean();
  const voided = (row) => row.channel === 'Shopify' && row.sourceOrderData?.financial_status === 'voided';
  const settledOrderNos = rows.filter((row) => isPaid(row) || voided(row)).map((row) => row.orderNo);
  const summary = buildOrderSummary(data, {
    returnRows: returnRows.map((row) => ({
      orderNo: row.orderNo, status: row.status, refundStatus: row.refundStatus, refundAmount: row.refundAmount,
    })),
    settledOrderNos,
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
    .select('code barcode sellingPrice').lean().setOptions({ skipTenantFilter: true });
  const byId = new Map(masters.map((m) => [String(m._id), m]));
  const byCode = new Map(masters.map((m) => [m.code, m]));
  const orderTotal = Number(dto.total) || 0;
  const onlyOne = items.length === 1;
  dto.items = items.map((item) => {
    const master = byId.get(String(item.masterSkuId || '')) || byCode.get(String(item.sku || '').trim().toUpperCase());
    const sellingPrice = Number(master?.sellingPrice) || 0;
    const price = Number(item.price) > 0 ? Number(item.price) : sellingPrice;
    const qty = Math.max(1, Number(item.qty) || 1);
    let discount = Math.max(0, Number(item.discount) || 0);
    // Older Shopify pulls stored selling price only — derive coupon from order total when possible.
    if (!discount && onlyOne && orderTotal > 0 && price * qty > orderTotal + 0.009) {
      discount = Math.round(((price * qty - orderTotal) / qty) * 100) / 100;
    }
    const finalPrice = Number(item.finalPrice) > 0
      ? Number(item.finalPrice)
      : Math.round((Math.max(0, price - discount)) * 100) / 100;
    return {
      ...item,
      barcode: master?.barcode || '',
      sellingPrice: sellingPrice || undefined,
      price,
      discount,
      finalPrice,
    };
  });
  return dto;
}

async function getOrder(req, res) {
  const tenantId = merchantTenant(req);
  const names = await vendorNamesFor(req, tenantId);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const dto = scopeToVendor(await decorateOne(tenantId, order), names);
  if (names && !dto.subOrders.length) throw new HttpError(404, 'Order not found');
  return successResponse(
    res,
    await withHsns(tenantId, await withPackages(tenantId, await withBarcodes(tenantId, await withAssignNotices(tenantId, dto)))),
    'Order',
  );
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

/** Fill blank line HSN from Master SKU / product / Tax default — display only (same sources as invoice). */
async function withHsns(tenantId, dto) {
  const items = dto.items || [];
  if (!items.length) return dto;
  const open = items.filter((item) => !String(item.hsn || '').trim());
  if (!open.length) return dto;
  const Tenant = require('../models/Tenant');
  const Product = require('../models/Product');
  const ids = items.map((item) => item.masterSkuId).filter((id) => mongoose.isValidObjectId(id));
  const codes = items.map((item) => String(item.sku || '').trim().toUpperCase()).filter(Boolean);
  const [masters, tenant] = await Promise.all([
    MasterSku.find({ tenantId, $or: [{ _id: { $in: ids } }, { code: { $in: codes } }] })
      .select('code hsnCode productId').setOptions({ skipTenantFilter: true }).lean(),
    Tenant.findById(tenantId).select('settings.taxGst.defaultHsn').setOptions({ skipTenantFilter: true }).lean(),
  ]);
  const productIds = masters.map((row) => row.productId).filter(Boolean);
  const products = productIds.length
    ? await Product.find({ tenantId, _id: { $in: productIds } }).select('hsnCode').setOptions({ skipTenantFilter: true }).lean()
    : [];
  const productOf = new Map(products.map((row) => [String(row._id), row]));
  const byId = new Map(masters.map((row) => [String(row._id), row]));
  const byCode = new Map(masters.map((row) => [row.code, row]));
  const defaultHsn = String(tenant?.settings?.taxGst?.defaultHsn || '').trim();
  return {
    ...dto,
    items: items.map((item) => {
      if (String(item.hsn || '').trim()) return item;
      const master = byId.get(String(item.masterSkuId || '')) || byCode.get(String(item.sku || '').trim().toUpperCase());
      const product = master ? productOf.get(String(master.productId || '')) : null;
      const hsn = String(master?.hsnCode || product?.hsnCode || defaultHsn || '').trim();
      return hsn ? { ...item, hsn } : item;
    }),
  };
}

async function getCustomerHistory(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  return successResponse(res, await customerHistory(tenantId, order), 'Customer history');
}

/** Single Order Sync: re-pull this Shopify order from Admin API into OMS. */
async function syncChannelOrder(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const { syncShopifyOrder } = require('../services/orderSync.service');
  const { order: fresh, result } = await syncShopifyOrder(tenantId, order.orderNo);
  const dto = await decorateOne(tenantId, fresh);
  const summary = result.updated
    ? 'Shopify order updated in OMS.'
    : result.unchanged
      ? 'Shopify order already matches OMS.'
      : 'Shopify order synced.';
  return successResponse(res, dto, summary);
}

/** Instant channel pull (no job queue) — Orders page refresh / Sync Orders. */
async function pullOrdersNow(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const hours = Math.min(168, Math.max(1, Number(req.body?.hours) || 48));
  const channels = Array.isArray(req.body?.channels) ? req.body.channels : undefined;
  const { pullOrdersNow: run } = require('../services/orderPullNow.service');
  const results = await run(tenantId, { hours, channels });
  bustOrderDesk(tenantId);
  const created = results.reduce((n, row) => n + (Number(row.created) || 0), 0);
  const failed = results.filter((row) => row.status === 'failed');
  const message = failed.length && !created
    ? (failed[0].lastError || 'Order pull failed')
    : created
      ? `${created} new order${created === 1 ? '' : 's'} pulled from channels`
      : 'Orders already up to date';
  return successResponse(res, { results, created }, message);
}

async function generateLabel(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  bustOrderDesk(tenantId);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.channel === 'Myntra') {
    throw new HttpError(400, `${order.channel} uses the marketplace courier. Print the channel label instead of a Delhivery AWB.`);
  }
  if (order.channel === 'Amazon') {
    const { amazonEasyShipLabel } = require('../services/amazonLabel.service');
    await amazonEasyShipLabel(tenantId, order.orderNo);
    const labelled = await findMaster(tenantId, order.orderNo);
    return successResponse(res, await decorateOne(tenantId, labelled), 'Amazon Easy Ship label made');
  }
  const subOrderId = req.body?.subOrderId || req.query.subOrderId;
  const { bookShopify, bookOtherCourier, courierLabelPdf } = require('../services/ship.service');
  const courier = String(req.body?.courier || 'delhivery');
  if (courier === 'delhivery') await bookShopify(tenantId, order.orderNo);
  else await bookOtherCourier(tenantId, order.orderNo, { courier, awb: req.body?.awb });
  const fresh = await findMaster(tenantId, order.orderNo);
  const dto = await decorateOne(tenantId, fresh);
  // Still fetch/store courier PDFs for reprint APIs, but Generate Label always prints the OMS packing slip.
  if (courier === 'delhivery' || courier === 'amazon-shipping' || courier === 'bluedart' || courier === 'shree-maruti') {
    try { await courierLabelPdf(tenantId, fresh.orderNo); } catch { /* optional */ }
  }
  let labelOrder = { ...dto };
  try {
    labelOrder = { ...dto, ...(await packingSlipWarehouse(tenantId, fresh.warehouseCode || 'WH-001')) };
  } catch {
    /* brand / warehouse enrich is best-effort for the packing slip */
  }
  return successResponse(res, {
    ...dto,
    labelHtml: labelHtml(labelOrder, subOrderId),
  }, 'Label generated');
}

/** Book (if needed) then print Shipway-style Label + Invoice on two 4×6 pages. */
async function generateLabelInvoice(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.channel === 'Myntra' || order.channel === 'Amazon') {
    throw new HttpError(400, `${order.channel} labels/invoices come from the marketplace. Use their documents.`);
  }
  const subOrderId = req.body?.subOrderId || req.query.subOrderId;
  const { bookShopify, bookOtherCourier } = require('../services/ship.service');
  if (!String(order.awb || '').trim()) {
    const courier = String(req.body?.courier || 'delhivery');
    if (courier === 'delhivery') await bookShopify(tenantId, order.orderNo);
    else await bookOtherCourier(tenantId, order.orderNo, { courier, awb: req.body?.awb });
  }
  const fresh = await findMaster(tenantId, order.orderNo);
  if (!fresh.invoiceGeneratedAt) {
    try {
      const { invoiceNumber } = require('../services/finance.service');
      fresh.invoiceGeneratedAt = new Date();
      fresh.invoiceNo = fresh.invoiceNo || invoiceNumber(fresh);
      await fresh.save();
    } catch { /* invoice number is best-effort for the packing slip */ }
  }
  const dto = await decorateOne(tenantId, fresh);
  let labelOrder = { ...dto };
  try {
    labelOrder = { ...dto, ...(await packingSlipWarehouse(tenantId, fresh.warehouseCode || 'WH-001')) };
  } catch { /* enrich best-effort */ }
  return successResponse(res, {
    ...dto,
    labelHtml: labelInvoiceHtml(labelOrder, subOrderId),
  }, 'Label + Invoice ready (4×6)');
}

async function cancelLabel(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.channel === 'Myntra') {
    throw new HttpError(400, `${order.channel} labels are cancelled in the seller panel.`);
  }
  const before = { status: order.status, awb: order.awb || '' };
  if (order.channel === 'Amazon') {
    const { cancelAmazonLabel } = require('../services/amazonLabel.service');
    await cancelAmazonLabel(tenantId, order.orderNo);
    const cleared = await findMaster(tenantId, order.orderNo);
    await recordFromReq(req, {
      tenantId,
      action: 'order.label_cancelled',
      resourceType: 'orders',
      resourceId: order._id,
      resourceDisplay: order.orderNo,
      before,
      after: { status: cleared.status, awb: '' },
    });
    return successResponse(res, await decorateOne(tenantId, cleared), 'Amazon label cancelled in OMSKing. Easy Ship has no cancel call, so the next label moves the same Amazon package to a new pickup slot.');
  }
  const { cancelShopifyLabel } = require('../services/ship.service');
  const courierName = order.courier === 'Amazon Shipping' ? 'Amazon Shipping' : 'Delhivery';
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
  return successResponse(res, await decorateOne(tenantId, cancelled), `Label cancelled. ${courierName} AWB is cancelled and Shopify is unfulfilled. The stock reserve stays until the order itself is cancelled.`);
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

/** Fills missing GST rate / HSN from the Master SKU, product, or Tax settings default HSN. */
async function fillLineTax(tenantId, order) {
  const { resolveLineRate } = require('../services/finance.service');
  const open = (order.items || []).filter((item) => !(Number(item.gst) > 0) || !item.hsn);
  if (!open.length) return [];
  const MasterSku = require('../models/MasterSku');
  const Product = require('../models/Product');
  const Tenant = require('../models/Tenant');
  const ids = open.map((item) => item.masterSkuId).filter(Boolean);
  const codes = open.map((item) => String(item.sku || '').trim().toUpperCase()).filter(Boolean);
  const [masters, tenant] = await Promise.all([
    MasterSku.find({ tenantId, $or: [{ _id: { $in: ids } }, { code: { $in: codes } }] })
      .select('code hsnCode gstRatePercent productId').setOptions({ skipTenantFilter: true }).lean(),
    Tenant.findById(tenantId).select('settings.taxGst').setOptions({ skipTenantFilter: true }).lean(),
  ]);
  const productIds = masters.map((row) => row.productId).filter(Boolean);
  const products = productIds.length
    ? await Product.find({ tenantId, _id: { $in: productIds } }).select('hsnCode gstRatePercent').setOptions({ skipTenantFilter: true }).lean()
    : [];
  const productOf = new Map(products.map((row) => [String(row._id), row]));
  const defaultHsn = String(tenant?.settings?.taxGst?.defaultHsn || '').trim();
  const defaultGst = tenant?.settings?.taxGst?.defaultGstRate;
  const missing = [];
  open.forEach((item) => {
    const master = masters.find((row) => String(row._id) === String(item.masterSkuId || ''))
      || masters.find((row) => row.code === String(item.sku || '').trim().toUpperCase());
    const product = master ? productOf.get(String(master.productId || '')) || {} : {};
    const rate = resolveLineRate(item, master, product);
    // Custom Shopify lines (LINE-/VAR-) often have no Master SKU — use Tax settings default GST %.
    const applied = rate === null && hasDefaultGst(defaultGst) ? Number(defaultGst) : rate;
    if (applied === null) missing.push(item.sku || item.name || 'item');
    else item.gst = applied;
    if (!item.hsn) {
      item.hsn = (master && (master.hsnCode || product.hsnCode)) || defaultHsn || '';
    }
  });
  return missing;
}

function hasDefaultGst(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
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
  const {
    gstinState, sameState, gstStateCode, shipToState, channelIssuesInvoice,
  } = require('../services/finance.service');
  const kind = req.body?.kind === 'credit' ? 'credit' : 'invoice';
  if (kind === 'invoice' && channelIssuesInvoice(order)) {
    throw new HttpError(400, `Invoice not created. ${order.channel} issues the tax invoice for this order. Open it from ${order.channel}.`);
  }
  if (kind === 'credit' && !order.invoiceGeneratedAt) {
    throw new HttpError(400, 'Credit note not created. No tax invoice was issued for this order, so there is nothing to credit.');
  }
  const frozen = order.invoiceSnapshot?.order ? order.invoiceSnapshot : null;
  // Empty snapshot (invoice issued while Order items were blank) is not frozen — rebuild from the live lines.
  const snapItems = frozen?.order?.items || [];
  const liveItems = order.items || [];
  const blankSnap = frozen && !snapItems.length && liveItems.length > 0;
  if (blankSnap) {
    order.invoiceSnapshot = undefined;
    order.markModified('invoiceSnapshot');
  }
  if (frozen && !blankSnap) {
    if (req.body?.customerGstin !== undefined) {
      const asked = String(req.body.customerGstin || '').replace(/\s+/g, '').toUpperCase();
      if (asked && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(asked)) {
        throw new HttpError(400, 'Customer GSTIN is not valid. It has 15 characters, like 07AAQCP4784P1ZB.');
      }
      order.customerGstin = asked;
      order.invoiceSnapshot = { ...frozen, order: { ...frozen.order, customerGstin: asked } };
      order.markModified('invoiceSnapshot');
    }
    if (kind === 'credit' && !order.creditNoteGeneratedAt) order.creditNoteGeneratedAt = new Date();
    const source = { ...order.toObject(), ...order.invoiceSnapshot.order };
    const pdf = buildInvoicePdf(source, { company: frozen.company, warehouseState: frozen.warehouseState, kind });
    await order.save();
    return sendInvoice(req, res, { tenantId, order, source, pdf, kind, warehouseState: frozen.warehouseState, emailInvoicePdf, mailboxOf, sendMail });
  }
  const tenant = await Tenant.findById(tenantId).setOptions({ skipTenantFilter: true });
  const ownCode = String(order.warehouseCode || '').trim();
  const own = ownCode ? await Warehouse.findOne({ tenantId, code: ownCode }).setOptions({ skipTenantFilter: true }) : null;
  const home = own || await Warehouse.findOne({ tenantId, code: 'WH-001' }).setOptions({ skipTenantFilter: true });
  const homeCode = home?.code || 'WH-001';
  const warehouseState = home?.address?.state || '';
  const gstin = String(tenant?.legalEntity?.gstin || '').trim();
  const registered = gstinState(gstin);
  if (registered && warehouseState && !sameState(registered, warehouseState)) {
    throw new HttpError(400, `Invoice not created. GSTIN ${gstin} is registered in ${registered}, but pickup warehouse ${homeCode} is in ${warehouseState}. Correct the GSTIN in Company Details or the state in Warehouses, then generate the invoice again.`);
  }
  if (!gstStateCode(warehouseState || registered)) {
    throw new HttpError(400, `Invoice not created. The seller state is unknown: warehouse ${homeCode} has ${warehouseState ? `"${warehouseState}", which is not a GST state` : 'no state'} and the company GSTIN is not set. Set the state in Warehouses or the GSTIN in Company Details.`);
  }
  if (!gstStateCode(shipToState(order))) {
    throw new HttpError(400, `Invoice not created. The place of supply could not be found: the buyer state "${shipToState(order) || order.city || ''}" is not a GST state. Add the state to the order address, then generate the invoice again.`);
  }
  if (req.body?.customerGstin !== undefined) {
    const customerGstin = String(req.body.customerGstin || '').replace(/\s+/g, '').toUpperCase();
    if (customerGstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(customerGstin)) {
      throw new HttpError(400, 'Customer GSTIN is not valid. It has 15 characters, like 07AAQCP4784P1ZB.');
    }
    order.customerGstin = customerGstin;
  }
  const missingRate = await fillLineTax(tenantId, order);
  if (missingRate.length) {
    throw new HttpError(400, `Invoice not created. No GST rate for ${missingRate.join(', ')}. Set the GST % on the Master SKU or product, then generate the invoice again.`);
  }
  if (kind === 'credit') {
    if (!order.creditNoteGeneratedAt) order.creditNoteGeneratedAt = new Date();
  } else if (!order.invoiceGeneratedAt) {
    order.invoiceGeneratedAt = new Date();
  }
  const legal = tenant?.legalEntity || {};
  const company = {
    companyName: tenant?.name || '',
    legalName: legal.legalName || '',
    brandName: legal.brandName || '',
    gstin: legal.gstin || '',
    email: legal.email || '',
    phone: legal.phone || '',
    address: legal.address || '',
    city: [legal.city, legal.district].filter(Boolean).join(', '),
    state: legal.state || '',
    website: legal.website
      || String(tenant?.settings?.storefrontUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };
  const sellerState = warehouseState || registered;
  const source = order.toObject();
  const pdf = buildInvoicePdf(source, { company, warehouseState: sellerState, kind });
  if (kind === 'invoice') {
    order.invoiceNo = pdf.invoiceNo;
    order.invoiceSnapshot = { order: invoiceFacts({ ...source, invoiceNo: pdf.invoiceNo }), company, warehouseState: sellerState };
  }
  await order.save();
  return sendInvoice(req, res, {
    tenantId, order, source: { ...source, invoiceNo: order.invoiceNo }, pdf, kind, warehouseState: sellerState, emailInvoicePdf, mailboxOf, sendMail,
  });
}

const INVOICE_FACTS = ['items', 'shippingCharge', 'total', 'currency', 'customer', 'customerGstin', 'address', 'city', 'shipState', 'phone',
  'invoiceNo', 'orderNo', 'externalOrderId', 'channelOrderNo', 'orderDate', 'paymentMode'];

function invoiceFacts(order) {
  return Object.fromEntries(INVOICE_FACTS.filter((key) => order[key] !== undefined).map((key) => [key, order[key]]));
}

async function sendInvoice(req, res, { tenantId, order, source, pdf, kind, warehouseState, emailInvoicePdf, mailboxOf, sendMail }) {
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
  const facts = invoiceFacts(source);
  const brand = await packingSlipWarehouse(tenantId, order.warehouseCode || 'WH-001');
  return successResponse(res, {
    ...dto,
    invoiceHtml: invoiceHtml({ ...dto, ...facts, ...brand, id: dto.id }, { warehouseState, kind }),
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
  bustOrderDesk(tenantId);
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
  bustOrderDesk(tenantId);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const beforeStatus = order.status;
  const status = String(req.body.status || '').trim();
  const allowed = new Set(['New', 'Processing', 'Pending', 'Packed', 'Ready to Ship', 'Dispatched', 'Delivered', 'Cancelled', 'Unfulfillable']);
  if (!allowed.has(status)) throw new HttpError(400, 'Unknown status');
  if (['Packed', 'Ready to Ship'].includes(status) && (order.items || []).some((item) => !item.masterSkuId)) {
    throw new HttpError(400, 'Map the SKU before this order can be packed.');
  }
  await require('../services/ship.service').assertStatusChange(tenantId, order, status);
  order.status = status;
  if (status === 'Dispatched' && !order.pickedUpAt) order.pickedUpAt = new Date();
  if (status === 'Cancelled') {
    order.cancelSource = 'oms';
    const { releaseOrderReserve } = require('../services/ship.service');
    await releaseOrderReserve(tenantId, order);
  }
  (order.subOrders || []).forEach((sub) => {
    sub.status = status;
    sub.deliveryStatus = deliveryStatusFor(status);
  });
  await order.save();
  // Label may have booked AWB while Shopify fulfill failed — Dispatched retries fulfill instantly.
  if (status === 'Dispatched' && String(order.channel || '').toLowerCase() === 'shopify' && String(order.awb || '').trim()) {
    await require('../services/ship.service').syncShopifyFulfillment(tenantId, order);
  }
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

/** Set HSN on this order line, Master SKU / product, and push to Shopify when mapped. */
async function updateItemHsn(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.invoiceGeneratedAt) {
    throw new HttpError(400, 'Invoice is already generated. HSN on this order is locked.');
  }
  const index = Number(req.params.index);
  const item = Number.isInteger(index) ? order.items[index] : null;
  if (!item) throw new HttpError(404, 'Order item not found');
  const { assertHsnCode } = require('../services/skuIdentity.service');
  const hsn = assertHsnCode(req.body?.hsn ?? req.body?.hsnCode);
  const before = item.hsn || '';
  item.hsn = hsn;
  order.markModified('items');
  await order.save();

  let shopify = { pushed: 0, failed: [] };
  if (item.masterSkuId) {
    const MasterSku = require('../models/MasterSku');
    const Product = require('../models/Product');
    const sku = await MasterSku.findOne({ _id: item.masterSkuId, tenantId }).setOptions({ skipTenantFilter: true });
    if (sku) {
      sku.hsnCode = hsn;
      await sku.save();
      if (sku.productId) {
        await Product.updateOne({ _id: sku.productId, tenantId }, { hsnCode: hsn }).setOptions({ skipTenantFilter: true });
      }
      const { pushMasterSkuHsnToShopify } = require('../services/shopifyHsn.service');
      shopify = await pushMasterSkuHsnToShopify(tenantId, sku._id, hsn);
    }
  }

  await recordFromReq(req, {
    tenantId,
    action: 'order.item_hsn_updated',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    before: { item: index, sku: item.sku, hsn: before },
    after: { item: index, sku: item.sku, hsn, shopify },
  });
  const dto = await decorateOne(tenantId, order);
  const note = shopify.pushed
    ? `HSN saved. Shopify updated on ${shopify.pushed} variant${shopify.pushed === 1 ? '' : 's'}.`
    : (shopify.failed?.length ? `HSN saved on OMS. Shopify: ${shopify.failed[0].reason}` : 'HSN saved');
  return successResponse(res, dto, note);
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
  const pastedAwb = String(req.body.awb || order.reversePickup?.awb || '').trim();
  if (!courier) throw new HttpError(400, 'Pick the reverse courier.');
  const { bookReversePickup } = require('../services/ship.service');
  const booked = await bookReversePickup(tenantId, order, {
    courier,
    reason,
    awb: pastedAwb,
  });
  order.reversePickup = {
    returnId: booked.returnId,
    awb: booked.awb,
    courier: booked.courier,
    reason: booked.reason,
    bookedAt: order.reversePickup?.bookedAt || new Date(),
  };
  order.markModified('reversePickup');
  await order.save();
  await recordFromReq(req, {
    tenantId,
    action: 'order.reverse_booked',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    before: null,
    after: {
      returnId: booked.returnId,
      awb: booked.awb,
      courier: booked.courier,
      reason: booked.reason,
      bookedViaApi: Boolean(booked.bookedViaApi),
    },
  });
  const dto = await decorateOne(tenantId, order);
  return successResponse(res, {
    ...dto,
    reverseLabelHtml: reversePickupHtml(dto),
  }, booked.bookedViaApi ? `Reverse pickup booked via ${booked.courier}` : 'Reverse pickup booked');
}

/** Update reverse courier / AWB so tracking can be filled after booking. */
async function patchReverse(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (!order.reversePickup?.returnId) {
    throw new HttpError(400, 'No reverse pickup on this order');
  }
  const before = {
    returnId: order.reversePickup.returnId,
    awb: order.reversePickup.awb || '',
    courier: order.reversePickup.courier || '',
  };
  if (req.body.courier != null) order.reversePickup.courier = String(req.body.courier || '').trim();
  if (req.body.awb != null) order.reversePickup.awb = String(req.body.awb || '').trim();
  if (req.body.reason != null) order.reversePickup.reason = String(req.body.reason || '').trim();
  if (!order.reversePickup.courier) throw new HttpError(400, 'Pick the reverse courier.');
  if (!order.reversePickup.awb) {
    throw new HttpError(400, 'Enter the reverse AWB so tracking shows on Returns.');
  }
  order.markModified('reversePickup');
  await order.save();
  await recordFromReq(req, {
    tenantId,
    action: 'order.reverse_updated',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    before,
    after: {
      returnId: order.reversePickup.returnId,
      awb: order.reversePickup.awb,
      courier: order.reversePickup.courier,
    },
  });
  return successResponse(res, await decorateOne(tenantId, order), 'Reverse tracking saved');
}

/** Drop a reverse pickup that has not been marked received yet. */
async function cancelReverse(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (!order.reversePickup?.returnId) {
    throw new HttpError(400, 'No reverse pickup on this order');
  }
  const before = {
    returnId: order.reversePickup.returnId,
    awb: order.reversePickup.awb || '',
    courier: order.reversePickup.courier || '',
  };
  order.reversePickup = {
    returnId: '',
    awb: '',
    courier: '',
    reason: '',
    bookedAt: undefined,
  };
  order.markModified('reversePickup');
  await order.save();
  await recordFromReq(req, {
    tenantId,
    action: 'order.reverse_cancelled',
    resourceType: 'orders',
    resourceId: order._id,
    resourceDisplay: order.orderNo,
    before,
    after: null,
  });
  return successResponse(res, await decorateOne(tenantId, order), 'Reverse pickup cancelled');
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

async function courierRates(req, res) {
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const { courierRates: rates } = require('../services/ship.service');
  return successResponse(res, await rates(tenantId, order.orderNo), 'Courier rates');
}

async function shipOrder(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  bustOrderDesk(tenantId);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.channel === 'Shopify') {
    throw new HttpError(400, 'Shopify ships on Delhivery. Use the label action.');
  }
  const { bookMarketplace } = require('../services/ship.service');
  const shipment = await bookMarketplace(tenantId, order.orderNo);
  const fresh = await findMaster(tenantId, order.orderNo);
  const dto = await decorateOne(tenantId, fresh);
  if (order.channel === 'Amazon') {
    const label = shipment.labelPdf ? 'Label PDF is ready to print.' : 'Amazon sent no label PDF; print it from Seller Central.';
    return successResponse(res, { ...dto, labelReady: Boolean(shipment.labelPdf) }, `Amazon Easy Ship label generated. AWB ${shipment.awb}. ${label}`);
  }
  return successResponse(res, dto, `${order.channel} tracking saved. Delhivery was not called.`);
}

async function closeManifest(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const { closeDayManifest } = require('../services/ship.service');
  const manifest = await closeDayManifest(tenantId);
  return successResponse(res, manifest, `Pickup requested for ${manifest.count} AWB${manifest.count === 1 ? '' : 's'} at WH-001`);
}

async function handOver(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const { handOver: run } = require('../services/handover.service');
  const data = await run(tenantId, req.user?.id, req.body?.orderIds);
  const moved = data.manifests.reduce((sum, row) => sum + row.count, 0);
  await recordFromReq(req, {
    tenantId,
    action: 'order.handover',
    resourceType: 'orders',
    resourceDisplay: data.manifests.map((row) => row.manifestNo).join(', '),
    before: null,
    after: { manifests: data.manifests.map((row) => ({ manifestNo: row.manifestNo, count: row.count })) },
  });
  return successResponse(res, data, `${moved} parcel${moved === 1 ? '' : 's'} moved to Ready to hand over`);
}

async function handoverManifests(req, res) {
  staffOnly(req);
  const { listManifests } = require('../services/handover.service');
  return successResponse(res, await listManifests(merchantTenant(req), { limit: req.query.limit }), 'Handover manifests');
}

async function handoverManifest(req, res) {
  staffOnly(req);
  const { getManifest } = require('../services/handover.service');
  return successResponse(res, await getManifest(merchantTenant(req), req.params.manifestNo), 'Handover manifest');
}

async function handoverManifestPickup(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const { generatePickup } = require('../services/handover.service');
  const manifest = await generatePickup(tenantId, req.params.manifestNo);
  await recordFromReq(req, {
    tenantId,
    action: 'order.manifest_pickup',
    resourceType: 'orders',
    resourceDisplay: manifest.manifestNo,
    before: null,
    after: { pickupId: manifest.pickupId, count: manifest.count, courier: manifest.courier },
  });
  return successResponse(res, manifest, `Pickup ${manifest.pickupId} requested for ${manifest.count} ${manifest.courier} parcel${manifest.count === 1 ? '' : 's'}`);
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
  const docs = await loadOrders(tenantId);
  const codByOrder = new Map(docs.map((doc) => [doc.orderNo, codCollectAmount(doc)]));
  const rows = await deskOrders(tenantId, docs);
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
    const cod = codByOrder.get(row.orderNo) || 0;
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
      codTotal: list.reduce((sum, row) => sum + Math.round(row.codAmount * 100), 0) / 100,
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

async function bookAmazonLabels(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const { amazonBulkLabels } = require('../services/amazonLabel.service');
  const result = await amazonBulkLabels(tenantId, req.body?.orderIds || req.body?.orderNos);
  const failed = result.failed.length ? ` · ${result.failed.length} not made` : '';
  return successResponse(res, result, `${result.done.length} Amazon Easy Ship label${result.done.length === 1 ? '' : 's'} made${failed}`);
}

async function amazonLabel(req, res) {
  staffOnly(req);
  const tenantId = merchantTenant(req);
  const order = await findMaster(tenantId, req.params.orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  const { amazonLabelPdf } = require('../services/amazonLabel.service');
  const { courierLabelPdf } = require('../services/ship.service');
  const pdf = order.channel === 'Amazon'
    ? await amazonLabelPdf(tenantId, order.orderNo)
    : await courierLabelPdf(tenantId, order.orderNo);
  const tag = order.channel === 'Amazon' ? 'amazon' : String(order.courier || 'courier').toLowerCase().replace(/\s+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${tag}-label-${String(order.orderNo).replace(/[^\w.-]/g, '_')}.pdf"`);
  return res.send(pdf);
}

module.exports = {
  listOrders, orderSummary, getOrder, getCustomerHistory, syncChannelOrder, pullOrdersNow, generateLabel, generateLabelInvoice, cancelLabel, generateInvoice, markPaid, assignSubOrder, lineCost, saveLineCost, vendorUpdate, patchStatus, editOrderDetails, updateNotes, updateItemPackage, updateItemHsn, mapItemSku, bookReverse, patchReverse, cancelReverse, bookBulkLabels, bookAmazonLabels, amazonLabel, shipOrder, closeManifest, courierManifests, shippingReadiness, courierRates, handOver, handoverManifests, handoverManifest, handoverManifestPickup,
};
