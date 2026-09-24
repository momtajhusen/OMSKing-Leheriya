const Product = require('../models/Product');
const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const { HttpError } = require('../utils/httpError');
const {
  generateMasterCode,
  normalizeSkuCode,
  normalizeBarcode,
  normalizeChannel,
} = require('./skuIdentity.service');

const IMPORT_ORDER = ['shopify', 'myntra', 'amazon'];

function attrsObject(mapLike) {
  if (!mapLike) return {};
  if (mapLike instanceof Map) return Object.fromEntries(mapLike);
  if (typeof mapLike.toObject === 'function') return mapLike.toObject();
  return { ...mapLike };
}

function mapMaster(row, mappings = []) {
  return {
    id: String(row._id),
    productId: row.productId ? String(row.productId._id || row.productId) : null,
    productName: row.productId?.name || row.name,
    code: row.code,
    name: row.name,
    variantAttributes: attrsObject(row.variantAttributes),
    barcode: row.barcode || '',
    costPrice: row.costPrice,
    mrp: row.mrp,
    sellingPrice: row.sellingPrice,
    hsnCode: row.hsnCode || row.productId?.hsnCode || '',
    gstRatePercent: row.gstRatePercent ?? row.productId?.gstRatePercent ?? null,
    status: row.status,
    codeLocked: row.codeLocked,
    channelMappings: mappings.map((m) => ({
      id: String(m._id),
      channel: m.channel,
      channelSku: m.channelSkuCode,
      status: m.syncStatus,
    })),
    createdAt: row.createdAt,
  };
}

function mapProduct(row, variants = []) {
  return {
    id: String(row._id),
    name: row.name,
    description: row.description,
    brand: row.brand,
    category: row.category,
    hsnCode: row.hsnCode,
    gstRatePercent: row.gstRatePercent,
    images: row.images,
    status: row.status,
    tags: row.tags,
    variantCount: variants.length,
    variants: variants.map((v) => mapMaster(v)),
    createdAt: row.createdAt,
  };
}

function mapMapping(row) {
  const master = row.masterSkuId && row.masterSkuId.code ? row.masterSkuId : null;
  return {
    id: String(row._id),
    masterSkuId: row.masterSkuId ? String(row.masterSkuId._id || row.masterSkuId) : null,
    masterSku: master?.code || null,
    productName: master?.name || row.channelTitle,
    channel: row.channel,
    channelSku: row.channelSkuCode,
    channelProductId: row.channelProductId,
    channelVariantId: row.channelVariantId,
    channelTitle: row.channelTitle,
    barcode: row.barcode || '',
    status: row.syncStatus,
    lastSync: row.lastSyncedAt,
    error: row.lastSyncError || '',
    isActive: row.isActive,
  };
}

async function findAutoMaster(tenantId, { channelSkuCode, barcode }) {
  const codeNorm = normalizeSkuCode(channelSkuCode);
  if (codeNorm) {
    const hit = await SkuMapping.findOne({
      tenantId,
      channelSkuCodeNorm: codeNorm,
      masterSkuId: { $ne: null },
      isActive: true,
    }).setOptions({ skipTenantFilter: true });
    if (hit?.masterSkuId) {
      return MasterSku.findById(hit.masterSkuId).setOptions({ skipTenantFilter: true });
    }
    const byCode = await MasterSku.findOne({ tenantId, code: codeNorm, status: 'active' }).setOptions({ skipTenantFilter: true });
    if (byCode) return byCode;
  }
  const bar = normalizeBarcode(barcode);
  if (bar) {
    const byBar = await MasterSku.findOne({ tenantId, barcode: bar, status: 'active' }).setOptions({ skipTenantFilter: true });
    if (byBar) return byBar;
  }
  return null;
}

function listingExtras(row) {
  return {
    name: row.productName || row.channelTitle || row.title || '',
    category: row.category || '',
    hsnCode: row.hsnCode || row.hsn || '',
    gstRatePercent: row.gstRatePercent != null && row.gstRatePercent !== '' ? Number(row.gstRatePercent) : undefined,
    variantAttributes: {
      ...(row.color ? { color: row.color } : {}),
      ...(row.size ? { size: row.size } : {}),
      ...(row.fabric ? { fabric: row.fabric } : {}),
    },
    barcode: row.barcode,
    sellingPrice: row.price != null && row.price !== '' ? Number(row.price) : undefined,
    mrp: row.mrp != null && row.mrp !== '' ? Number(row.mrp) : undefined,
  };
}

async function ingestListing(tenantId, userId, row, options = {}) {
  const channel = normalizeChannel(row.channel);
  if (!['shopify', 'amazon', 'myntra', 'custom'].includes(channel)) {
    throw new HttpError(400, `Unknown channel: ${row.channel}`);
  }
  const channelSkuCode = String(row.channelSkuCode || row.sku || '').trim();
  if (!channelSkuCode) throw new HttpError(400, 'channelSkuCode is required');
  const channelVariantId = String(row.channelVariantId || channelSkuCode).trim();
  const channelSkuCodeNorm = normalizeSkuCode(channelSkuCode);
  const createMaster = options.createMaster === true;

  const existing = await SkuMapping.findOne({ tenantId, channel, channelVariantId }).setOptions({ skipTenantFilter: true });
  if (existing) {
    if (row.channelTitle || row.title) existing.channelTitle = String(row.channelTitle || row.title);
    if (row.channelProductId) existing.channelProductId = String(row.channelProductId);
    if (row.price != null && row.price !== '') existing.channelSellingPrice = Number(row.price);
    if (row.barcode) existing.barcode = normalizeBarcode(row.barcode);
    await existing.save();
    let master = null;
    if (existing.masterSkuId) {
      master = await MasterSku.findById(existing.masterSkuId).setOptions({ skipTenantFilter: true });
    }
    return { action: 'exists', mapping: existing, master };
  }

  const auto = await findAutoMaster(tenantId, { channelSkuCode, barcode: row.barcode });
  const mapping = await SkuMapping.create({
    tenantId,
    masterSkuId: auto?._id || null,
    channel,
    channelProductId: String(row.channelProductId || ''),
    channelVariantId,
    channelSkuCode,
    channelSkuCodeNorm,
    channelTitle: String(row.channelTitle || row.title || ''),
    channelSellingPrice: row.price != null && row.price !== '' ? Number(row.price) : null,
    barcode: normalizeBarcode(row.barcode),
    syncStatus: auto ? 'synced' : 'unmapped',
    lastSyncedAt: auto ? new Date() : undefined,
    lastSyncError: '',
    createdBy: userId,
  });
  if (auto && !auto.codeLocked) {
    auto.codeLocked = true;
    await auto.save();
  }
  if (!auto && createMaster) {
    const created = await createMasterForListing(tenantId, userId, mapping, listingExtras(row));
    return { action: 'created', mapping: created.mapping, master: created.master };
  }
  return { action: auto ? 'auto-mapped' : 'unmapped', mapping, master: auto || null };
}

async function findOrCreateProduct(tenantId, userId, mapping, extras = {}) {
  if (mapping.channelProductId) {
    const sibling = await SkuMapping.findOne({
      tenantId,
      channel: mapping.channel,
      channelProductId: mapping.channelProductId,
      masterSkuId: { $ne: null },
      _id: { $ne: mapping._id },
    }).setOptions({ skipTenantFilter: true });
    if (sibling?.masterSkuId) {
      const siblingMaster = await MasterSku.findById(sibling.masterSkuId).setOptions({ skipTenantFilter: true });
      if (siblingMaster?.productId) {
        const shared = await Product.findById(siblingMaster.productId).setOptions({ skipTenantFilter: true });
        if (shared) return shared;
      }
    }
  }
  const name = extras.name || mapping.channelTitle || mapping.channelSkuCode;
  const existing = await Product.findOne({ tenantId, name }).setOptions({ skipTenantFilter: true });
  if (existing) return existing;
  return Product.create({
    tenantId,
    name,
    category: extras.category || '',
    hsnCode: extras.hsnCode || '',
    gstRatePercent: extras.gstRatePercent ?? 5,
    status: 'active',
    createdBy: userId,
  });
}

async function createMasterForListing(tenantId, userId, mapping, extras = {}) {
  if (mapping.masterSkuId) throw new HttpError(400, 'Listing is already mapped');
  const product = await findOrCreateProduct(tenantId, userId, mapping, extras);
  const attrs = extras.variantAttributes || {};
  const code = await generateMasterCode(tenantId, {
    productName: product.name,
    variantAttributes: attrs,
    requested: extras.code,
  });
  const master = await MasterSku.create({
    tenantId,
    productId: product._id,
    code,
    name: extras.variantName || `${product.name}`,
    variantAttributes: attrs,
    barcode: extras.barcode || mapping.barcode || '',
    sellingPrice: mapping.channelSellingPrice || extras.sellingPrice || 0,
    mrp: extras.mrp || mapping.channelSellingPrice || 0,
    hsnCode: extras.hsnCode || product.hsnCode || '',
    gstRatePercent: extras.gstRatePercent ?? product.gstRatePercent ?? null,
    status: 'active',
    codeLocked: true,
    createdBy: userId,
  });
  mapping.masterSkuId = master._id;
  mapping.syncStatus = 'synced';
  mapping.lastSyncedAt = new Date();
  mapping.lastSyncError = '';
  mapping.updatedBy = userId;
  await mapping.save();
  return { product, master, mapping };
}

async function attachMappingToCode(tenantId, userId, mapping, masterCode) {
  const master = await MasterSku.findOne({ tenantId, code: normalizeSkuCode(masterCode) }).setOptions({ skipTenantFilter: true });
  if (!master) throw new HttpError(404, 'Master SKU not found');
  mapping.masterSkuId = master._id;
  mapping.syncStatus = 'synced';
  mapping.lastSyncedAt = new Date();
  mapping.lastSyncError = '';
  mapping.updatedBy = userId;
  await mapping.save();
  if (!master.codeLocked) {
    master.codeLocked = true;
    await master.save();
  }
  return { master, mapping };
}

function splitCsvLine(line) {
  const cols = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ''; });
    return {
      channelSkuCode: row.channelSkuCode || row.sku,
      channelProductId: row.channelProductId,
      channelVariantId: row.channelVariantId,
      channelTitle: row.title || row.channelTitle,
      barcode: row.barcode,
      price: row.price,
      mrp: row.mrp,
      hsnCode: row.hsn || row.hsnCode,
      category: row.category,
      color: row.color,
      size: row.size,
      fabric: row.fabric,
    };
  }).filter((row) => row.channelSkuCode);
}

async function importChannel(tenantId, userId, channel, rows) {
  const ch = normalizeChannel(channel);
  const createMaster = ch === 'shopify';
  const results = [];
  for (const raw of rows) {
    try {
      const out = await ingestListing(tenantId, userId, { ...raw, channel: ch }, { createMaster });
      results.push({
        sku: raw.channelSkuCode || raw.sku,
        title: raw.channelTitle || raw.title,
        channel: ch,
        result: out.action,
        masterSku: out.master?.code || undefined,
      });
    } catch (err) {
      results.push({
        sku: raw.channelSkuCode || raw.sku,
        title: raw.channelTitle || raw.title,
        channel: ch,
        result: 'failed',
        error: err.message,
      });
    }
  }
  return {
    channel: ch,
    created: results.filter((r) => r.result === 'created').length,
    autoMapped: results.filter((r) => r.result === 'auto-mapped').length,
    unmapped: results.filter((r) => r.result === 'unmapped').length,
    exists: results.filter((r) => r.result === 'exists').length,
    failed: results.filter((r) => r.result === 'failed').length,
    rows: results,
  };
}

async function unmapListing(tenantId, userId, mapping) {
  if (!mapping.masterSkuId) throw new HttpError(400, 'Listing is not mapped');
  mapping.masterSkuId = null;
  mapping.syncStatus = 'unmapped';
  mapping.lastSyncError = '';
  mapping.updatedBy = userId;
  await mapping.save();
  return { mapping };
}

async function retryFailedMapping(tenantId, userId, mapping) {
  if (mapping.syncStatus !== 'error') throw new HttpError(400, 'Only failed rows can be retried');
  if (mapping.masterSkuId) {
    mapping.syncStatus = 'synced';
    mapping.lastSyncError = '';
    mapping.lastSyncedAt = new Date();
    mapping.updatedBy = userId;
    await mapping.save();
    return { action: 'restored', mapping };
  }
  const auto = await findAutoMaster(tenantId, {
    channelSkuCode: mapping.channelSkuCode,
    barcode: mapping.barcode,
  });
  if (auto) {
    mapping.masterSkuId = auto._id;
    mapping.syncStatus = 'synced';
    mapping.lastSyncError = '';
    mapping.lastSyncedAt = new Date();
    mapping.updatedBy = userId;
    await mapping.save();
    if (!auto.codeLocked) {
      auto.codeLocked = true;
      await auto.save();
    }
    return { action: 'auto-mapped', mapping, master: auto };
  }
  mapping.syncStatus = 'unmapped';
  mapping.lastSyncError = '';
  mapping.updatedBy = userId;
  await mapping.save();
  return { action: 'unmapped', mapping };
}

module.exports = {
  IMPORT_ORDER,
  mapMaster,
  mapProduct,
  mapMapping,
  findAutoMaster,
  ingestListing,
  createMasterForListing,
  attachMappingToCode,
  unmapListing,
  retryFailedMapping,
  parseCsv,
  importChannel,
};
