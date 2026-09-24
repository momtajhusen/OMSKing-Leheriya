const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
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
} = require('../services/catalogMapping.service');
const { merchantTenant } = require('./products.controller');

async function listMappings(req, res) {
  const tenantId = merchantTenant(req);
  const tab = String(req.query.tab || 'mapped');
  const channel = String(req.query.channel || '').toLowerCase();
  const q = String(req.query.q || '').toLowerCase();
  let filter = { tenantId };
  if (tab === 'unmapped') filter.syncStatus = 'unmapped';
  else if (tab === 'failed') filter.syncStatus = 'error';
  else if (tab === 'mapped') filter.syncStatus = { $in: ['synced', 'pending'] };
  if (['shopify', 'amazon', 'myntra', 'custom'].includes(channel)) filter.channel = channel;
  const rows = await SkuMapping.find(filter)
    .populate('masterSkuId')
    .sort({ updatedAt: -1 })
    .setOptions({ skipTenantFilter: true });
  let data = rows.map(mapMapping);
  if (q) {
    data = data.filter((row) =>
      (row.channelSku || '').toLowerCase().includes(q)
      || (row.masterSku || '').toLowerCase().includes(q)
      || (row.channelTitle || '').toLowerCase().includes(q)
      || (row.productName || '').toLowerCase().includes(q)
    );
  }
  return paginatedResponse(res, data, 1, data.length || 50, data.length, 'SKU mappings');
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
  const masters = await MasterSku.find({ tenantId, status: 'active' }).setOptions({ skipTenantFilter: true });
  const mapped = await SkuMapping.find({
    tenantId,
    channel,
    masterSkuId: { $ne: null },
    isActive: true,
  }).setOptions({ skipTenantFilter: true });
  const have = new Set(mapped.map((m) => String(m.masterSkuId)));
  const data = masters.filter((s) => !have.has(String(s._id))).map((s) => ({
    id: String(s._id),
    masterSku: s.code,
    productName: s.name,
    channel,
    status: 'unlisted',
    channelSku: '—',
  }));
  return paginatedResponse(res, data, 1, data.length || 50, data.length, 'Unlisted');
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

async function importOrderHint(req, res) {
  return successResponse(res, { order: IMPORT_ORDER }, 'Import Shopify, then Myntra, then Amazon');
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
  importOrderHint,
};
