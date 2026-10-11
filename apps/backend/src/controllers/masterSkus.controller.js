const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
const { pageOf, pageRequest, escapeRegex } = require('../utils/page');
const { generateMasterCode, normalizeSkuCode, assertHsnCode } = require('../services/skuIdentity.service');
const { mapMaster } = require('../services/catalogMapping.service');
const { merchantTenant } = require('./products.controller');
const { recordFromReq } = require('../services/auditLog.service');

function skuSnap(sku) {
  return {
    code: sku.code,
    name: sku.name,
    barcode: sku.barcode || '',
    hsnCode: sku.hsnCode || '',
    gstRatePercent: sku.gstRatePercent,
    mrp: sku.mrp,
    sellingPrice: sku.sellingPrice,
    status: sku.status,
  };
}

async function masterRows(tenantId, rows) {
  const ids = rows.map((row) => row._id);
  const maps = ids.length
    ? await SkuMapping.find({ tenantId, masterSkuId: { $in: ids } }).setOptions({ skipTenantFilter: true })
    : [];
  const bySku = {};
  maps.forEach((row) => {
    const key = String(row.masterSkuId);
    bySku[key] = bySku[key] || [];
    bySku[key].push(row);
  });
  return rows.map((row) => mapMaster(row, bySku[String(row._id)] || []));
}

function masterFilter(tenantId, q) {
  const filter = { tenantId };
  const text = String(q || '').trim();
  if (!text) return filter;
  const rx = new RegExp(escapeRegex(text), 'i');
  filter.$or = [{ code: rx }, { name: rx }, { barcode: rx }];
  return filter;
}

async function listMasterSkus(req, res) {
  const tenantId = merchantTenant(req);
  const filter = masterFilter(tenantId, req.query.q);
  const paging = pageRequest(req.query);
  if (!paging) {
    const rows = await MasterSku.find(filter)
      .populate('productId')
      .sort({ createdAt: -1 })
      .setOptions({ skipTenantFilter: true });
    const data = await masterRows(tenantId, rows);
    const paged = pageOf(data, req.query);
    return paginatedResponse(res, paged.rows, paged.page, paged.limit, paged.total, 'Master SKUs');
  }
  const [total, rows] = await Promise.all([
    MasterSku.countDocuments(filter).setOptions({ skipTenantFilter: true }),
    MasterSku.find(filter)
      .populate('productId')
      .sort({ createdAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .setOptions({ skipTenantFilter: true }),
  ]);
  const data = await masterRows(tenantId, rows);
  return paginatedResponse(res, data, paging.page, paging.limit, total, 'Master SKUs');
}

async function createMasterSku(req, res) {
  const tenantId = merchantTenant(req);
  const attrs = req.body.variantAttributes || {};
  const code = await generateMasterCode(tenantId, {
    productName: req.body.name,
    variantAttributes: attrs,
    requested: req.body.code,
  });
  const sku = await MasterSku.create({
    tenantId,
    productId: req.body.productId || null,
    code,
    name: req.body.name,
    variantAttributes: attrs,
    barcode: req.body.barcode || '',
    costPrice: req.body.costPrice || 0,
    mrp: req.body.mrp || 0,
    sellingPrice: req.body.sellingPrice || 0,
    hsnCode: assertHsnCode(req.body.hsnCode),
    gstRatePercent: req.body.gstRatePercent ?? null,
    status: 'active',
    createdBy: req.user.id,
  });
  await recordFromReq(req, {
    tenantId,
    action: 'sku.created',
    resourceType: 'master_skus',
    resourceId: sku._id,
    resourceDisplay: sku.code,
    before: null,
    after: skuSnap(sku),
  });
  return successResponse(res, mapMaster(sku, []), 'Master SKU created', 201);
}

async function updateMasterSku(req, res) {
  const tenantId = merchantTenant(req);
  const sku = await MasterSku.findOne({ _id: req.params.id, tenantId }).populate('productId').setOptions({ skipTenantFilter: true });
  if (!sku) throw new HttpError(404, 'Master SKU not found');
  const before = skuSnap(sku);
  if (req.body.code && normalizeSkuCode(req.body.code) !== sku.code) {
    if (sku.codeLocked) throw new HttpError(400, 'Master SKU code is locked after first mapping');
    sku.code = await generateMasterCode(tenantId, { requested: req.body.code });
  }
  ['name', 'barcode', 'status'].forEach((key) => {
    if (req.body[key] != null) sku[key] = req.body[key];
  });
  if (req.body.hsnCode != null) sku.hsnCode = assertHsnCode(req.body.hsnCode);
  ['costPrice', 'mrp', 'sellingPrice', 'weightKg', 'gstRatePercent'].forEach((key) => {
    if (req.body[key] != null) sku[key] = req.body[key];
  });
  if (req.body.variantAttributes) sku.variantAttributes = req.body.variantAttributes;
  sku.updatedBy = req.user.id;
  await sku.save();
  await recordFromReq(req, {
    tenantId,
    action: 'sku.updated',
    resourceType: 'master_skus',
    resourceId: sku._id,
    resourceDisplay: sku.code,
    before,
    after: skuSnap(sku),
  });
  const maps = await SkuMapping.find({ tenantId, masterSkuId: sku._id }).setOptions({ skipTenantFilter: true });
  return successResponse(res, mapMaster(sku, maps), 'Master SKU updated');
}

async function getMasterSku(req, res) {
  const tenantId = merchantTenant(req);
  const sku = await MasterSku.findOne({ _id: req.params.id, tenantId }).populate('productId').setOptions({ skipTenantFilter: true });
  if (!sku) throw new HttpError(404, 'Master SKU not found');
  const maps = await SkuMapping.find({ tenantId, masterSkuId: sku._id }).setOptions({ skipTenantFilter: true });
  return successResponse(res, mapMaster(sku, maps), 'Master SKU');
}

module.exports = { listMasterSkus, createMasterSku, updateMasterSku, getMasterSku };
