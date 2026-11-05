const Product = require('../models/Product');
const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const { HttpError } = require('../utils/httpError');
const { firstImage } = require('../lib/catalogImages');
const {
  generateMasterCode,
  normalizeSkuCode,
  normalizeBarcode,
  normalizeChannel,
} = require('./skuIdentity.service');

const IMPORT_ORDER = ['shopify', 'myntra', 'amazon'];

async function shopifyOwnsCatalog(tenantId) {
  const ChannelConnection = require('../models/ChannelConnection');
  const shopify = await ChannelConnection.findOne({ tenantId, channel: 'shopify' }).setOptions({ skipTenantFilter: true });
  if (shopify?.status === 'connected') return true;
  const listings = await SkuMapping.countDocuments({
    tenantId,
    channel: 'shopify',
    masterSkuId: { $ne: null },
  }).setOptions({ skipTenantFilter: true });
  return listings > 0;
}

function attrsObject(mapLike) {
  if (!mapLike) return {};
  if (mapLike instanceof Map) return Object.fromEntries(mapLike);
  if (typeof mapLike.toObject === 'function') return mapLike.toObject();
  return { ...mapLike };
}

function variantPhoto(mappings) {
  const ordered = [...mappings].sort((a, b) => Number(b.channel === 'shopify') - Number(a.channel === 'shopify'));
  return firstImage(ordered.map((m) => m.imageUrl));
}

function mapMaster(row, mappings = []) {
  return {
    id: String(row._id),
    productId: row.productId ? String(row.productId._id || row.productId) : null,
    productName: row.productId?.name || row.name,
    imageUrl: variantPhoto(mappings) || firstImage(row.productId?.images),
    code: row.code,
    name: row.name,
    variantAttributes: attrsObject(row.variantAttributes),
    barcode: row.barcode || '',
    costPrice: row.costPrice,
    mrp: row.mrp,
    sellingPrice: row.sellingPrice,
    weightKg: row.weightKg || 0,
    dimensionsCm: {
      l: row.dimensionsCm?.l || 0,
      w: row.dimensionsCm?.w || 0,
      h: row.dimensionsCm?.h || 0,
    },
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

function mapProduct(row, variants = [], mappingsByMaster = {}) {
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
    variants: variants.map((v) => mapMaster(v, mappingsByMaster[String(v._id)] || [])),
    createdAt: row.createdAt,
  };
}

function mapMapping(row) {
  const master = row.masterSkuId && row.masterSkuId.code ? row.masterSkuId : null;
  return {
    id: String(row._id),
    masterSkuId: row.masterSkuId ? String(row.masterSkuId._id || row.masterSkuId) : null,
    masterSku: master?.code || null,
    masterBarcode: master?.barcode || row.barcode || '',
    productName: master?.name || row.channelTitle,
    imageUrl: firstImage([row.imageUrl]) || firstImage(master?.productId?.images),
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

async function linkOpenOrders(tenantId, mapping) {
  if (!mapping?.masterSkuId) return;
  const sku = String(mapping.channelSkuCode || '').trim();
  if (!sku) return;
  const Order = require('../models/Order');
  const match = new RegExp(`^${sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const orders = await Order.find({
    tenantId,
    $or: [
      { 'items.sku': match },
      { 'subOrders.sku': match },
      { 'channelLines.sku': match },
    ],
  }).setOptions({ skipTenantFilter: true });
  for (const order of orders) {
    let changed = false;
    (order.items || []).forEach((item) => {
      if (!match.test(item.sku || '')) return;
      if (!item.masterSkuId) {
        item.masterSkuId = mapping.masterSkuId;
        changed = true;
      }
      if (!item.skuMappingId && mapping._id) {
        item.skuMappingId = mapping._id;
        changed = true;
      }
    });
    (order.subOrders || []).forEach((sub) => {
      if (!match.test(sub.sku || '')) return;
      if (!sub.masterSkuId) {
        sub.masterSkuId = mapping.masterSkuId;
        changed = true;
      }
    });
    if (changed) await order.save();
  }
}

async function rememberBarcode(master, barcode) {
  const bar = normalizeBarcode(barcode);
  if (!master || !bar || master.barcode) return master;
  master.barcode = bar;
  await master.save();
  return master;
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
    brand: row.vendor || row.brand || '',
    category: row.category || '',
    hsnCode: row.hsnCode || row.hsn || '',
    gstRatePercent: row.gstRatePercent != null && row.gstRatePercent !== '' ? Number(row.gstRatePercent) : undefined,
    variantAttributes: {
      ...(row.color ? { color: row.color } : {}),
      ...(row.size ? { size: row.size } : {}),
      ...(row.fabric ? { fabric: row.fabric } : {}),
    },
    barcode: row.barcode,
    image: row.image || row.imageUrl || '',
    productImage: row.productImage || '',
    sellingPrice: row.price != null && row.price !== '' ? Number(row.price) : undefined,
    mrp: row.mrp != null && row.mrp !== '' ? Number(row.mrp) : undefined,
  };
}

async function ingestListing(tenantId, userId, row, options = {}) {
  const channel = normalizeChannel(row.channel);
  const { isKnownChannel } = require('../channels/registry');
  if (channel !== 'custom' && !isKnownChannel(channel)) {
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
    const photo = firstImage([row.image || row.imageUrl]);
    if (photo) existing.imageUrl = photo;
    await existing.save();
    let master = null;
    if (existing.masterSkuId) {
      master = await MasterSku.findById(existing.masterSkuId).setOptions({ skipTenantFilter: true });
      if (master) await rememberBarcode(master, row.barcode);
      if (master?.productId && channel === 'shopify') {
        const product = await Product.findOne({ _id: master.productId, tenantId }).setOptions({ skipTenantFilter: true });
        await rememberShopifyFields(product, listingExtras(row));
      }
      await linkOpenOrders(tenantId, existing);
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
    imageUrl: firstImage([row.image || row.imageUrl]),
    syncStatus: auto ? 'synced' : 'unmapped',
    lastSyncedAt: auto ? new Date() : undefined,
    lastSyncError: '',
    createdBy: userId,
  });
  if (auto && !auto.codeLocked) {
    auto.codeLocked = true;
    await auto.save();
  }
  if (auto) await rememberBarcode(auto, row.barcode);
  if (!auto && createMaster) {
    const created = await createMasterForListing(tenantId, userId, mapping, listingExtras(row));
    await linkOpenOrders(tenantId, created.mapping);
    return { action: 'created', mapping: created.mapping, master: created.master };
  }
  if (mapping.masterSkuId) await linkOpenOrders(tenantId, mapping);
  return { action: auto ? 'auto-mapped' : 'unmapped', mapping, master: auto || null };
}

async function findOrCreateProduct(tenantId, userId, mapping, extras = {}) {
  const refresh = (product) => (mapping.channel === 'shopify' ? rememberShopifyFields(product, extras) : product);
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
        if (shared) return rememberImage(await refresh(shared), extras.image);
      }
    }
  }
  const name = extras.name || mapping.channelTitle || mapping.channelSkuCode;
  const existing = await Product.findOne({ tenantId, name }).setOptions({ skipTenantFilter: true });
  if (existing) return rememberImage(await refresh(existing), extras.image);
  const image = firstImage([extras.image]);
  return Product.create({
    tenantId,
    name,
    brand: extras.brand || '',
    category: extras.category || '',
    hsnCode: extras.hsnCode || '',
    gstRatePercent: extras.gstRatePercent ?? 5,
    images: image ? [image] : [],
    status: 'active',
    createdBy: userId,
  });
}

async function rememberShopifyFields(product, extras = {}) {
  if (!product) return product;
  let changed = false;
  [['brand', extras.brand], ['category', extras.category], ['hsnCode', extras.hsnCode]].forEach(([field, value]) => {
    const next = String(value || '').trim();
    if (next && product[field] !== next) {
      product[field] = next;
      changed = true;
    }
  });
  const photo = firstImage([extras.productImage]);
  const current = firstImage(product.images);
  if (photo && current !== photo && !current.startsWith('/uploads/')) {
    product.images = [photo, ...(product.images || []).filter((url) => url !== current && url !== photo)];
    changed = true;
  }
  if (changed) await product.save();
  return product;
}

async function rememberImage(product, image) {
  const url = firstImage([image]);
  if (!product || !url || firstImage(product.images)) return product;
  product.images = [url];
  await product.save();
  return product;
}

async function createMasterForListing(tenantId, userId, mapping, extras = {}) {
  if (mapping.masterSkuId) throw new HttpError(400, 'Listing is already mapped');
  const product = await findOrCreateProduct(tenantId, userId, mapping, extras);
  const attrs = extras.variantAttributes || {};
  const requested = extras.code === null ? undefined : (extras.code || mapping.channelSkuCode);
  const code = await generateMasterCode(tenantId, {
    productName: product.name,
    variantAttributes: attrs,
    requested,
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
  await linkOpenOrders(tenantId, mapping);
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
  await linkOpenOrders(tenantId, mapping);
  return { master, mapping };
}

async function mapOrderItem(tenantId, userId, order, sku, masterCode) {
  const code = String(masterCode || '').trim();
  if (!code) throw new HttpError(400, 'Master SKU code is required');
  const want = normalizeSkuCode(sku);
  const item = want && (order.items || []).find((row) => normalizeSkuCode(row.sku) === want);
  if (!item) throw new HttpError(404, `${sku || 'That SKU'} is not on this order`);
  const master = await MasterSku.findOne({ tenantId, code: normalizeSkuCode(code) }).setOptions({ skipTenantFilter: true });
  if (!master) throw new HttpError(404, 'Master SKU not found');
  const channel = normalizeChannel(order.channel);
  let mapping = await SkuMapping.findOne({ tenantId, channel, channelSkuCodeNorm: want }).setOptions({ skipTenantFilter: true });
  if (!mapping) {
    const out = await ingestListing(tenantId, userId, {
      channel,
      channelSkuCode: item.sku,
      title: item.name,
      imageUrl: item.imageUrl,
    });
    mapping = out.mapping;
  }
  return attachMappingToCode(tenantId, userId, mapping, master.code);
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
      image: row.image || row.imageUrl || '',
    };
  }).filter((row) => row.channelSkuCode);
}

async function importChannel(tenantId, userId, channel, rows) {
  const ch = normalizeChannel(channel);
  const shopifyFirst = await shopifyOwnsCatalog(tenantId);
  const createMaster = ch === 'shopify' || (ch === 'myntra' && !shopifyFirst);
  const results = [];
  for (const raw of rows) {
    try {
      const out = await ingestListing(tenantId, userId, { ...raw, channel: ch }, { createMaster });
      results.push({
        sku: raw.channelSkuCode || raw.sku,
        title: raw.channelTitle || raw.title,
        image: raw.image || raw.imageUrl || '',
        channel: ch,
        result: out.action,
        masterSku: out.master?.code || undefined,
      });
    } catch (err) {
      results.push({
        sku: raw.channelSkuCode || raw.sku,
        title: raw.channelTitle || raw.title,
        image: raw.image || raw.imageUrl || '',
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

async function explainUnmapped(tenantId, rows) {
  const out = new Map();
  const list = rows.filter((row) => row.syncStatus === 'unmapped' && !row.masterSkuId);
  if (!list.length) return out;
  const norms = [...new Set(list.map((row) => row.channelSkuCodeNorm || normalizeSkuCode(row.channelSkuCode)).filter(Boolean))];
  const bars = [...new Set(list.map((row) => normalizeBarcode(row.barcode)).filter(Boolean))];
  const [siblings, byCode, byBar] = await Promise.all([
    SkuMapping.find({ tenantId, channelSkuCodeNorm: { $in: norms }, masterSkuId: { $ne: null }, isActive: true })
      .select('channelSkuCodeNorm masterSkuId').setOptions({ skipTenantFilter: true }).lean(),
    MasterSku.find({ tenantId, code: { $in: norms } })
      .select('code status').setOptions({ skipTenantFilter: true }).lean(),
    bars.length
      ? MasterSku.find({ tenantId, barcode: { $in: bars }, status: 'active' })
        .select('code barcode').setOptions({ skipTenantFilter: true }).lean()
      : [],
  ]);
  const siblingMasters = siblings.length
    ? await MasterSku.find({ tenantId, _id: { $in: siblings.map((row) => row.masterSkuId) }, status: 'active' })
      .select('code').setOptions({ skipTenantFilter: true }).lean()
    : [];
  const codeOfId = new Map(siblingMasters.map((row) => [String(row._id), row.code]));
  const siblingByNorm = new Map();
  siblings.forEach((row) => {
    const code = codeOfId.get(String(row.masterSkuId));
    if (code && !siblingByNorm.has(row.channelSkuCodeNorm)) siblingByNorm.set(row.channelSkuCodeNorm, code);
  });
  const masterByCode = new Map(byCode.map((row) => [row.code, row]));
  const masterByBar = new Map(byBar.map((row) => [row.barcode, row.code]));

  list.forEach((row) => {
    const norm = row.channelSkuCodeNorm || normalizeSkuCode(row.channelSkuCode);
    const bar = normalizeBarcode(row.barcode);
    const sameCode = masterByCode.get(norm);
    let reason;
    let suggestedMasterSku = null;
    if (sameCode && sameCode.status === 'active') {
      suggestedMasterSku = sameCode.code;
      reason = `Master SKU ${sameCode.code} has the same code but is not linked to this listing. Press Map to link it.`;
    } else if (siblingByNorm.has(norm)) {
      suggestedMasterSku = siblingByNorm.get(norm);
      reason = `Another listing with SKU ${row.channelSkuCode} is mapped to Master SKU ${suggestedMasterSku}. Press Map to link this one too.`;
    } else if (bar && masterByBar.has(bar)) {
      suggestedMasterSku = masterByBar.get(bar);
      reason = `Master SKU ${suggestedMasterSku} has the same barcode ${bar}. Press Map to link it.`;
    } else if (sameCode) {
      reason = `Master SKU ${sameCode.code} is discontinued, so it is not auto-matched. Reactivate it or map to another code.`;
    } else {
      reason = `No Master SKU has code ${norm}${bar ? ` or barcode ${bar}` : `, and ${row.channel} sent no barcode`}. Type an existing Master SKU code or Create as new.`;
    }
    out.set(String(row._id), { reason, suggestedMasterSku });
  });
  return out;
}

module.exports = {
  IMPORT_ORDER,
  shopifyOwnsCatalog,
  mapMaster,
  mapProduct,
  mapMapping,
  findAutoMaster,
  ingestListing,
  createMasterForListing,
  attachMappingToCode,
  mapOrderItem,
  unmapListing,
  retryFailedMapping,
  explainUnmapped,
  parseCsv,
  importChannel,
};
