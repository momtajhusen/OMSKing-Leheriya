const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
const { pageOf, pageRequest, escapeRegex } = require('../utils/page');
const {
  mapMapping,
  ingestListing,
  createMasterForListing,
  attachMappingToCode,
  unmapListing,
  retryFailedMapping,
  parseCsv,
  importChannel,
  IMPORT_ORDER,
  shopifyOwnsCatalog,
} = require('../services/catalogMapping.service');
const { merchantTenant } = require('./products.controller');
const { pullChannel } = require('../services/catalogPull.service');
const { imagesBySku, imageForSku } = require('../lib/catalogImages');

function paintMapping(row, bySku) {
  const mapped = mapMapping(row);
  if (mapped.imageUrl) return mapped;
  const url = imageForSku(bySku, mapped.masterSku)
    || imageForSku(bySku, mapped.channelSku)
    || imageForSku(bySku, mapped.productName);
  return url ? { ...mapped, imageUrl: url } : mapped;
}

async function listMappings(req, res) {
  const tenantId = merchantTenant(req);
  const tab = String(req.query.tab || 'mapped');
  const channel = String(req.query.channel || '').toLowerCase();
  const q = String(req.query.q || '').trim();
  const filter = { tenantId };
  if (tab === 'unmapped') filter.syncStatus = 'unmapped';
  else if (tab === 'failed') filter.syncStatus = 'error';
  else if (tab === 'mapped') filter.syncStatus = { $in: ['synced', 'pending'] };
  const { isKnownChannel } = require('../channels/registry');
  if (channel === 'custom' || isKnownChannel(channel)) filter.channel = channel;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const masters = await MasterSku.find({
      tenantId,
      $or: [{ code: rx }, { name: rx }],
    }).select('_id').setOptions({ skipTenantFilter: true }).lean();
    filter.$or = [
      { channelSkuCode: rx },
      { channelTitle: rx },
      { channelSkuCodeNorm: rx },
      ...(masters.length ? [{ masterSkuId: { $in: masters.map((row) => row._id) } }] : []),
    ];
  }
  const paging = pageRequest(req.query);
  if (!paging) {
    const rows = await SkuMapping.find(filter)
      .populate('masterSkuId')
      .sort({ updatedAt: -1 })
      .setOptions({ skipTenantFilter: true });
    const bySku = await imagesBySku(tenantId);
    const data = rows.map((row) => paintMapping(row, bySku));
    const paged = pageOf(data, req.query);
    return paginatedResponse(res, paged.rows, paged.page, paged.limit, paged.total, 'SKU mappings');
  }
  const [total, rows] = await Promise.all([
    SkuMapping.countDocuments(filter).setOptions({ skipTenantFilter: true }),
    SkuMapping.find(filter)
      .populate('masterSkuId')
      .sort({ updatedAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .setOptions({ skipTenantFilter: true }),
  ]);
  const bySku = await imagesBySku(tenantId, rows.flatMap((row) => {
    const master = row.masterSkuId && row.masterSkuId.code ? row.masterSkuId : null;
    return [master?.code, row.channelSkuCode, master?.name || row.channelTitle];
  }));
  const data = rows.map((row) => paintMapping(row, bySku));
  return paginatedResponse(res, data, paging.page, paging.limit, total, 'SKU mappings');
}

async function mappingSummary(req, res) {
  const tenantId = merchantTenant(req);
  const channel = String(req.query.channel || 'amazon').toLowerCase();
  const [mapped, unmapped, failed, masters, listed] = await Promise.all([
    SkuMapping.countDocuments({ tenantId, syncStatus: { $in: ['synced', 'pending'] } }).setOptions({ skipTenantFilter: true }),
    SkuMapping.countDocuments({ tenantId, syncStatus: 'unmapped' }).setOptions({ skipTenantFilter: true }),
    SkuMapping.countDocuments({ tenantId, syncStatus: 'error' }).setOptions({ skipTenantFilter: true }),
    MasterSku.countDocuments({ tenantId, status: 'active' }).setOptions({ skipTenantFilter: true }),
    SkuMapping.find({
      tenantId,
      channel,
      masterSkuId: { $ne: null },
      isActive: true,
    }).select('masterSkuId').setOptions({ skipTenantFilter: true }),
  ]);
  const listedIds = new Set(listed.map((row) => String(row.masterSkuId)));
  return successResponse(res, {
    mapped,
    unmapped,
    failed,
    unlisted: Math.max(0, masters - listedIds.size),
    channel,
  }, 'Mapping summary');
}

async function listUnlisted(req, res) {
  const tenantId = merchantTenant(req);
  const channel = String(req.query.channel || 'amazon').toLowerCase();
  const mapped = await SkuMapping.find({
    tenantId,
    channel,
    masterSkuId: { $ne: null },
    isActive: true,
  }).select('masterSkuId').setOptions({ skipTenantFilter: true }).lean();
  const have = mapped.map((row) => row.masterSkuId).filter(Boolean);
  const filter = { tenantId, status: 'active' };
  if (have.length) filter._id = { $nin: have };
  const shape = (row) => ({
    id: String(row._id),
    masterSku: row.code,
    barcode: row.barcode || '',
    productName: row.name,
    channel,
    status: 'unlisted',
    channelSku: '—',
  });
  const paging = pageRequest(req.query);
  if (!paging) {
    const masters = await MasterSku.find(filter).setOptions({ skipTenantFilter: true });
    const data = masters.map(shape);
    const paged = pageOf(data, req.query);
    return paginatedResponse(res, paged.rows, paged.page, paged.limit, paged.total, 'Unlisted');
  }
  const [total, rows] = await Promise.all([
    MasterSku.countDocuments(filter).setOptions({ skipTenantFilter: true }),
    MasterSku.find(filter)
      .sort({ createdAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .setOptions({ skipTenantFilter: true })
      .lean(),
  ]);
  return paginatedResponse(res, rows.map(shape), paging.page, paging.limit, total, 'Unlisted');
}

async function ingest(req, res) {
  const tenantId = merchantTenant(req);
  const out = await ingestListing(tenantId, req.user.id, req.body);
  const populated = await SkuMapping.findById(out.mapping._id).populate('masterSkuId').setOptions({ skipTenantFilter: true });
  return successResponse(res, { action: out.action, mapping: mapMapping(populated) }, 'Listing ingested', 201);
}

async function mapToMaster(req, res) {
  const tenantId = merchantTenant(req);
  const mapping = await SkuMapping.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!mapping) throw new HttpError(404, 'Mapping not found');
  const out = await attachMappingToCode(tenantId, req.user.id, mapping, req.body.masterSkuCode);
  const populated = await SkuMapping.findById(out.mapping._id).populate('masterSkuId').setOptions({ skipTenantFilter: true });
  return successResponse(res, mapMapping(populated), 'Mapped to Master SKU');
}

async function createAsNew(req, res) {
  const tenantId = merchantTenant(req);
  const mapping = await SkuMapping.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!mapping) throw new HttpError(404, 'Mapping not found');
  await createMasterForListing(tenantId, req.user.id, mapping, req.body);
  const populated = await SkuMapping.findById(mapping._id).populate('masterSkuId').setOptions({ skipTenantFilter: true });
  return successResponse(res, mapMapping(populated), 'Created Master SKU and mapped');
}

async function unmap(req, res) {
  const tenantId = merchantTenant(req);
  const mapping = await SkuMapping.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!mapping) throw new HttpError(404, 'Mapping not found');
  await unmapListing(tenantId, req.user.id, mapping);
  const populated = await SkuMapping.findById(mapping._id).populate('masterSkuId').setOptions({ skipTenantFilter: true });
  return successResponse(res, mapMapping(populated), 'Listing unmapped');
}

async function retry(req, res) {
  const tenantId = merchantTenant(req);
  const mapping = await SkuMapping.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!mapping) throw new HttpError(404, 'Mapping not found');
  const out = await retryFailedMapping(tenantId, req.user.id, mapping);
  const populated = await SkuMapping.findById(out.mapping._id).populate('masterSkuId').setOptions({ skipTenantFilter: true });
  return successResponse(res, { action: out.action, mapping: mapMapping(populated) }, 'Retry finished');
}

async function importListings(req, res) {
  const tenantId = merchantTenant(req);
  const channel = req.body.channel;
  let rows = req.body.rows;
  if (!rows && req.body.csv) rows = parseCsv(req.body.csv);
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'Provide CSV or rows[]');
  const summary = await importChannel(tenantId, req.user.id, channel, rows);
  return successResponse(res, summary, `Imported ${channel}`, 201);
}

async function pullLiveCatalog(req, res) {
  const tenantId = merchantTenant(req);
  const channel = String(req.body?.channel || '').toLowerCase();
  const { isKnownChannel } = require('../channels/registry');
  if (!isKnownChannel(channel)) throw new HttpError(400, 'Unknown channel');
  const summary = await pullChannel(tenantId, req.user.id, channel);
  return successResponse(res, summary, `Pulled ${channel} catalog`);
}

async function importOrderHint(req, res) {
  const tenantId = merchantTenant(req);
  const shopifyFirst = await shopifyOwnsCatalog(tenantId);
  return successResponse(res, {
    order: IMPORT_ORDER,
    masterChannel: shopifyFirst ? 'shopify' : 'myntra',
  }, 'Import Shopify, then Myntra, then Amazon');
}

module.exports = {
  listMappings,
  mappingSummary,
  listUnlisted,
  ingest,
  mapToMaster,
  createAsNew,
  unmap,
  retry,
  importListings,
  pullLiveCatalog,
  importOrderHint,
};
