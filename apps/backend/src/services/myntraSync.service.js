const Order = require('../models/Order');
const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const { createMyntraClient } = require('../adapters/myntra/client');
const { getConnection, credsOf, patchCreds } = require('./channelConnection.service');
const { ingestListing, createMasterForListing } = require('./catalogMapping.service');
const { withSubOrders, deliveryStatusFor } = require('../lib/orderSubOrders');
const { HttpError } = require('../utils/httpError');
const DEFAULT_LOOKBACK_DAYS = 30;

// Release codes (getOrderList) and the line codes order detail returns (S = shipped, C = complete).
const STATUS_MAP = {
  Q: 'New',
  RFR: 'New',
  WP: 'Processing',
  PK: 'Ready to Ship',
  SH: 'Dispatched',
  S: 'Dispatched',
  L: 'Dispatched',
  DL: 'Delivered',
  C: 'Delivered',
  IC: 'Cancelled',
  F: 'Cancelled',
  RTO: 'Cancelled',
};
const STATUS_RANK = ['New', 'Processing', 'Packed', 'Ready to Ship', 'Dispatched', 'Delivered'];

function omsStatus(code) {
  return STATUS_MAP[String(code || '').toUpperCase()] || 'Processing';
}

function paymentModeOf(method) {
  const text = String(method || '').toLowerCase();
  if (text.includes('partial')) return 'Partially Paid';
  if (text === 'cod' || text.includes('cash')) return 'COD';
  return 'Prepaid';
}

/** Least-advanced live line wins; an order is Cancelled only when every line is. */
function orderStatus(lines) {
  const live = lines.map((l) => omsStatus(l.status)).filter((s) => s !== 'Cancelled');
  if (!live.length) return 'Cancelled';
  return live.sort((a, b) => STATUS_RANK.indexOf(a) - STATUS_RANK.indexOf(b))[0];
}

/** Myntra dates arrive as "DD-MM-YYYY HH:mm:ss" (IST). */
function parseMyntraDate(value) {
  if (!value) return undefined;
  const m = String(value).match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m;
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+05:30`);
}

function lineGstRate(line) {
  return (line.taxEntries || []).reduce((sum, tax) => sum + (Number(tax.taxRate) || 0), 0);
}

async function connectedClient(tenantId) {
  const row = await getConnection(tenantId, 'myntra');
  if (!row) throw new HttpError(400, 'Myntra is not connected for this workspace');
  const creds = credsOf(row);
  if (!creds.merchantId || !creds.secretKey) {
    throw new HttpError(400, 'Myntra Merchant Id and Secret Key are required');
  }
  const client = createMyntraClient(creds, {
    saveTokens: (tokens) => patchCreds(row, tokens),
    retryDelayMs: process.env.NODE_ENV === 'test' ? 0 : 1000,
  });
  return { row, creds, client };
}

async function masterNamesFor(tenantId, skus) {
  const maps = await SkuMapping.find({ tenantId, channel: 'myntra', channelVariantId: { $in: skus } })
    .setOptions({ skipTenantFilter: true }).lean();
  const ids = maps.map((m) => m.masterSkuId).filter(Boolean);
  const masters = ids.length
    ? await MasterSku.find({ _id: { $in: ids } }).setOptions({ skipTenantFilter: true }).lean()
    : [];
  const byId = new Map(masters.map((m) => [String(m._id), m]));
  const out = new Map();
  maps.forEach((m) => {
    const master = m.masterSkuId ? byId.get(String(m.masterSkuId)) : null;
    if (master) {
      out.set(m.channelVariantId, {
        id: String(master._id),
        mappingId: String(m._id),
        name: master.name,
        code: master.code,
        imageUrl: master.imageUrl || '',
      });
    }
  });
  return out;
}

/**
 * Builds the OMS order shape from one or more Myntra seller-order payloads
 * (GET /partner/v4/order/:sellerOrderId or the create-order push) that share a Myntra orderId.
 */
function mapMyntraOrder(orderId, details, masters = new Map()) {
  const head = details[0] || {};
  const lines = [];
  details.forEach((detail) => {
    (detail.orderLineEntries || []).forEach((line) => {
      lines.push({ detail, line });
    });
  });

  const items = lines.map(({ line }) => {
    const master = masters.get(String(line.sku));
    return {
      name: master?.name || String(line.sku || ''),
      sku: String(line.sku || ''),
      masterSkuId: master?.id || null,
      skuMappingId: master?.mappingId || null,
      qty: Number(line.quantity) || 1,
      price: Number(line.lineFinalAmount ?? line.sellingPrice ?? line.mrp) || 0,
      hsn: String(line.hsnCode || ''),
      gst: lineGstRate(line),
      imageUrl: master?.imageUrl || '',
      fulfilmentSource: 'Offline',
    };
  });

  const channelLines = lines.map(({ detail, line }) => ({
    sellerOrderId: String(detail.sellerOrderId || line.sellerOrderId || ''),
    orderLineId: String(line.orderLineId || ''),
    sku: String(line.sku || ''),
    status: String(line.status_code || line.status || '').toUpperCase(),
    packetId: String(line.packetId || detail.packetId || ''),
    invoiceNumber: String(line.invoiceNumber || ''),
    trackingNumber: String(detail.trackingNumber || line.trackingNumber || ''),
    courierCode: String(detail.courierCode || line.courierCode || ''),
    cancellationReason: String(line.cancellationReason || ''),
    packByTime: parseMyntraDate(line.packByTime),
    shipByTime: parseMyntraDate(line.shipByTime),
  }));

  const firstWith = (key) => channelLines.find((l) => l[key])?.[key] || '';
  const createdOn = lines.map(({ line }) => parseMyntraDate(line.createdOn)).filter(Boolean).sort((a, b) => a - b)[0];
  const tracking = firstWith('trackingNumber');
  const address = [head.address, head.locality].filter(Boolean).join(', ');
  const city = [head.city, head.stateName || head.state, head.zipcode].filter(Boolean).join(', ');
  const status = orderStatus(channelLines);

  return {
    orderNo: `MYN-${orderId}`,
    externalOrderId: String(orderId),
    channel: 'Myntra',
    source: 'channel_api',
    customer: String(head.receiverName || head.customerName || ''),
    email: String(head.email || ''),
    phone: String(head.mobile || head.phone || ''),
    address,
    city,
    paymentMode: paymentModeOf(head.paymentMethod),
    status,
    channelStatus: [...new Set(channelLines.map((l) => l.status).filter(Boolean))].join(', '),
    warehouseCode: String(lines[0]?.line?.warehouse || head.warehouse || ''),
    items,
    total: items.reduce((sum, item) => sum + item.price, 0),
    courier: tracking ? (firstWith('courierCode') || 'Myntra Logistics') : '',
    awb: tracking,
    invoiceNo: firstWith('invoiceNumber'),
    orderDate: createdOn || new Date(),
    channelLines,
  };
}

/**
 * Upserts a mapped Myntra order. Channel-owned fields (status, AWB, invoice, lines) are refreshed;
 * OMS-owned fields (vendor assignment, labels, reverse pickup) are kept.
 */
async function upsertMappedOrder(tenantId, mapped) {
  const sellerIds = [...new Set(mapped.channelLines.map((l) => l.sellerOrderId).filter(Boolean))];
  const existing = await Order.findOne({
    tenantId,
    $or: [
      { orderNo: mapped.orderNo },
      ...(sellerIds.length ? [{ channel: 'Myntra', 'channelLines.sellerOrderId': { $in: sellerIds } }] : []),
    ],
  }).setOptions({ skipTenantFilter: true });
  const now = new Date();
  if (!existing) {
    const doc = withSubOrders({ ...mapped, id: mapped.orderNo, createdAt: mapped.orderDate });
    delete doc.id;
    delete doc.createdAt;
    delete doc.subOrderIndexMap;
    await Order.create({ ...doc, tenantId, lastChannelSyncAt: now });
    return 'created';
  }
  const before = JSON.stringify([existing.status, existing.channelStatus, existing.awb, existing.invoiceNo]);
  const lines = [
    ...existing.channelLines.map((l) => (l.toObject ? l.toObject() : l)).filter((l) => !sellerIds.includes(l.sellerOrderId)),
    ...mapped.channelLines,
  ];
  existing.status = orderStatus(lines);
  existing.channelStatus = [...new Set(lines.map((l) => l.status).filter(Boolean))].join(', ');
  existing.channelLines = lines;
  existing.awb = mapped.awb || existing.awb;
  existing.courier = mapped.courier || existing.courier;
  existing.invoiceNo = mapped.invoiceNo || existing.invoiceNo;
  existing.warehouseCode = mapped.warehouseCode || existing.warehouseCode;
  const bySku = new Map(mapped.items.map((item) => [item.sku, item]));
  existing.items.forEach((item) => {
    const next = bySku.get(item.sku);
    if (!next) return;
    if (next.name && next.name !== next.sku) item.name = next.name;
    if (next.masterSkuId) item.masterSkuId = next.masterSkuId;
    if (next.skuMappingId) item.skuMappingId = next.skuMappingId;
  });
  existing.subOrders.forEach((sub) => {
    const next = bySku.get(sub.sku);
    if (next?.name && next.name !== next.sku) sub.title = next.name;
    if (next?.masterSkuId) sub.masterSkuId = next.masterSkuId;
    const line = lines.find((l) => l.sku === sub.sku);
    if (!line) return;
    sub.status = omsStatus(line.status);
    sub.deliveryStatus = deliveryStatusFor(sub.status);
  });
  existing.lastChannelSyncAt = now;
  await existing.save();
  const after = JSON.stringify([existing.status, existing.channelStatus, existing.awb, existing.invoiceNo]);
  return before === after ? 'unchanged' : 'updated';
}

/** Shopify is the master catalog once connected; until then Myntra SKUs become Master SKUs themselves. */
async function myntraCreatesMasters(tenantId) {
  const shopify = await getConnection(tenantId, 'shopify');
  return !(shopify && shopify.status === 'connected');
}

async function createMasterFromMyntra(tenantId, userId, mapping, line = {}) {
  const extras = {
    code: mapping.channelSkuCode,
    mrp: Number(line.mrp) || undefined,
    gstRatePercent: line.taxEntries ? lineGstRate(line) : undefined,
  };
  try {
    return await createMasterForListing(tenantId, userId, mapping, extras);
  } catch (err) {
    if (err.statusCode !== 409) throw err;
    return createMasterForListing(tenantId, userId, mapping, { ...extras, code: null });
  }
}

/** One-off: turns every unmapped Myntra listing into a Product + Master SKU named by its SKU code. */
async function createMastersForUnmapped(tenantId, userId) {
  const rows = await SkuMapping.find({ tenantId, channel: 'myntra', masterSkuId: null })
    .setOptions({ skipTenantFilter: true });
  const out = { created: 0, failed: 0, errors: [] };
  for (const mapping of rows) {
    try {
      await createMasterFromMyntra(tenantId, userId, mapping);
      out.created += 1;
    } catch (err) {
      out.failed += 1;
      if (out.errors.length < 5) out.errors.push(`${mapping.channelSkuCode}: ${err.message}`);
    }
  }
  return out;
}

async function ingestOrderSkus(tenantId, userId, details) {
  const seen = new Map();
  details.forEach((detail) => (detail.orderLineEntries || []).forEach((line) => {
    if (line.sku && !seen.has(line.sku)) seen.set(String(line.sku), line);
  }));
  const counts = { mapped: 0, unmapped: 0 };
  let autoMaster = null;
  for (const [sku, line] of seen) {
    const res = await ingestListing(tenantId, userId, {
      channel: 'myntra',
      channelSkuCode: sku,
      channelVariantId: sku,
      barcode: line.barcode || line.ean || line.eanCode || line.gtin || line.upc || '',
      price: line.lineFinalAmount ?? line.mrp,
      mrp: line.mrp,
    });
    let mapped = Boolean(res.mapping?.masterSkuId);
    if (!mapped && res.mapping) {
      if (autoMaster === null) autoMaster = await myntraCreatesMasters(tenantId);
      if (autoMaster) {
        await createMasterFromMyntra(tenantId, userId, res.mapping, line);
        mapped = true;
      }
    }
    if (mapped) counts.mapped += 1;
    else counts.unmapped += 1;
  }
  return { skus: [...seen.keys()], ...counts };
}

/**
 * Pulls Myntra orders for [from, to] and upserts them. Safe to re-run: orders are keyed by MYN-<orderId>.
 */
async function pullMyntraOrders(tenantId, { from, to, userId, client: injected } = {}) {
  let client = injected;
  let row = null;
  if (!client) ({ client, row } = await connectedClient(tenantId));
  const end = to ? new Date(to) : new Date();
  const start = from
    ? new Date(from)
    : (row?.importOrdersFrom ? new Date(row.importOrdersFrom) : new Date(end.getTime() - DEFAULT_LOOKBACK_DAYS * 864e5));

  const listErrors = [];
  const refs = await client.listOrderRefs({ from: start, to: end, errors: listErrors });
  if (!refs.length && listErrors.length) throw new Error(`Myntra order list failed: ${listErrors[0]}`);
  const byOrder = new Map();
  refs.forEach((ref) => {
    if (!byOrder.has(ref.orderId)) byOrder.set(ref.orderId, new Set());
    if (ref.sellerOrderId) byOrder.get(ref.orderId).add(ref.sellerOrderId);
  });

  const result = {
    fetched: byOrder.size,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    errors: listErrors.slice(0, 5),
    skus: 0,
    unmappedSkus: 0,
  };
  for (const [orderId, sellerIds] of byOrder) {
    try {
      const details = [];
      for (const sellerOrderId of sellerIds) details.push(await client.getOrder(sellerOrderId));
      const skuInfo = await ingestOrderSkus(tenantId, userId, details);
      result.skus += skuInfo.skus.length;
      result.unmappedSkus += skuInfo.unmapped;
      const masters = await masterNamesFor(tenantId, skuInfo.skus);
      const action = await upsertMappedOrder(tenantId, mapMyntraOrder(orderId, details, masters));
      result[action] += 1;
    } catch (err) {
      result.failed += 1;
      if (result.errors.length < 5) result.errors.push(`${orderId}: ${err.message}`);
    }
  }
  return { ...result, from: start, to: end };
}

async function myntraStock(tenantId, skus) {
  const { client } = await connectedClient(tenantId);
  const { rows, failed } = await client.searchInventory(skus);
  return {
    rows: rows.map((row) => ({
      sku: row.sku,
      stores: (row.stores || []).map((s) => ({ storeCode: s.stores_code || s.store_code, quantity: Number(s.inventoryCount) || 0 })),
      total: (row.stores || []).reduce((sum, s) => sum + (Number(s.inventoryCount) || 0), 0),
    })),
    failed,
  };
}

/** Live side effect on the seller account: Myntra stock becomes exactly `quantity`. */
async function pushMyntraInventory(tenantId, items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'items[] is required');
  const { client, creds, row } = await connectedClient(tenantId);
  const storeCode = creds.warehouseCode || creds.storeId || row.warehouseCode;
  if (!storeCode) throw new HttpError(400, 'Myntra warehouse / store code is missing on the connection');
  return client.updateInventory(items, { storeCode });
}

async function myntraDocument(tenantId, packetId, type) {
  const { client } = await connectedClient(tenantId);
  return type === 'invoice' ? client.invoice(packetId) : client.shippingLabel(packetId);
}

module.exports = {
  STATUS_MAP,
  omsStatus,
  orderStatus,
  parseMyntraDate,
  mapMyntraOrder,
  upsertMappedOrder,
  ingestOrderSkus,
  createMastersForUnmapped,
  masterNamesFor,
  pullMyntraOrders,
  myntraStock,
  pushMyntraInventory,
  myntraDocument,
  connectedClient,
};
