const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
const { generateMasterCode, normalizeSkuCode } = require('../services/skuIdentity.service');
const { mapMaster } = require('../services/catalogMapping.service');
const { merchantTenant } = require('./products.controller');

async function listMasterSkus(req, res) {
  const tenantId = merchantTenant(req);
  const q = String(req.query.q || '').toLowerCase();
  const rows = await MasterSku.find({ tenantId })
    .populate('productId')
    .sort({ createdAt: -1 })
    .setOptions({ skipTenantFilter: true });
  const ids = rows.map((r) => r._id);
  const maps = await SkuMapping.find({ tenantId, masterSkuId: { $in: ids } }).setOptions({ skipTenantFilter: true });
  const bySku = {};
  maps.forEach((m) => {
    const key = String(m.masterSkuId);
    bySku[key] = bySku[key] || [];
    bySku[key].push(m);
  });
  let data = rows.map((r) => mapMaster(r, bySku[String(r._id)] || []));
  if (q) {
    data = data.filter((s) =>
      s.code.toLowerCase().includes(q)
      || s.name.toLowerCase().includes(q)
      || (s.barcode || '').toLowerCase().includes(q)
    );
  }
  return paginatedResponse(res, data, 1, data.length || 50, data.length, 'Master SKUs');
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
    hsnCode: req.body.hsnCode || '',
    gstRatePercent: req.body.gstRatePercent ?? null,
    status: 'active',
    createdBy: req.user.id,
  });
  return successResponse(res, mapMaster(sku, []), 'Master SKU created', 201);
}

async function updateMasterSku(req, res) {
  const tenantId = merchantTenant(req);
  const sku = await MasterSku.findOne({ _id: req.params.id, tenantId }).populate('productId').setOptions({ skipTenantFilter: true });
  if (!sku) throw new HttpError(404, 'Master SKU not found');
  if (req.body.code && normalizeSkuCode(req.body.code) !== sku.code) {
    if (sku.codeLocked) throw new HttpError(400, 'Master SKU code is locked after first mapping');
    sku.code = await generateMasterCode(tenantId, { requested: req.body.code });
  }
  ['name', 'barcode', 'hsnCode', 'status'].forEach((key) => {
    if (req.body[key] != null) sku[key] = req.body[key];
  });
  ['costPrice', 'mrp', 'sellingPrice', 'weightKg', 'gstRatePercent'].forEach((key) => {
    if (req.body[key] != null) sku[key] = req.body[key];
  });
  if (req.body.variantAttributes) sku.variantAttributes = req.body.variantAttributes;
  sku.updatedBy = req.user.id;
  await sku.save();
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
