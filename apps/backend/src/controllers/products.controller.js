const Product = require('../models/Product');
const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const Inventory = require('../models/Inventory');
const InventoryReservation = require('../models/InventoryReservation');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
const { sessionTenantId } = require('../lib/tenantAccess');
const { generateMasterCode, assertHsnCode } = require('../services/skuIdentity.service');
const { mapProduct, mapMaster } = require('../services/catalogMapping.service');
const { publicUploadPath } = require('../middleware/uploadImage');
const { recordFromReq } = require('../services/auditLog.service');

function productSnap(product) {
  return {
    name: product.name,
    category: product.category || '',
    hsnCode: product.hsnCode || '',
    gstRatePercent: product.gstRatePercent,
    status: product.status,
  };
}

function merchantTenant(req) {
  const tenantId = sessionTenantId(req);
  if (!tenantId || req.skipTenantFilter) throw new HttpError(400, 'Open a merchant tenant first');
  return tenantId;
}

async function listProducts(req, res) {
  const tenantId = merchantTenant(req);
  const q = String(req.query.q || '').toLowerCase();
  const products = await Product.find({ tenantId }).sort({ createdAt: -1 }).setOptions({ skipTenantFilter: true });
  const ids = products.map((p) => p._id);
  const variants = await MasterSku.find({ tenantId, productId: { $in: ids } }).setOptions({ skipTenantFilter: true });
  const byProduct = {};
  variants.forEach((v) => {
    const key = String(v.productId);
    byProduct[key] = byProduct[key] || [];
    byProduct[key].push(v);
  });
  let data = products.map((p) => mapProduct(p, byProduct[String(p._id)] || []));
  if (q) {
    data = data.filter((p) =>
      p.name.toLowerCase().includes(q)
      || (p.hsnCode || '').toLowerCase().includes(q)
      || (p.category || '').toLowerCase().includes(q)
      || (p.brand || '').toLowerCase().includes(q)
    );
  }
  return paginatedResponse(res, data, 1, data.length || 50, data.length, 'Products');
}

async function createProduct(req, res) {
  const tenantId = merchantTenant(req);
  const userId = req.user.id;
  const product = await Product.create({
    tenantId,
    name: req.body.name,
    description: req.body.description || '',
    brand: req.body.brand || '',
    category: req.body.category || '',
    hsnCode: assertHsnCode(req.body.hsnCode),
    gstRatePercent: req.body.gstRatePercent ?? 5,
    images: req.body.images ? normalizeImages(req.body.images) : [],
    status: req.body.status || 'active',
    tags: req.body.tags || [],
    createdBy: userId,
  });
  const variantInputs = Array.isArray(req.body.variants) && req.body.variants.length
    ? req.body.variants
    : [{ name: req.body.name, variantAttributes: {} }];
  const created = [];
  for (const item of variantInputs) {
    const attrs = item.variantAttributes || {};
    const code = await generateMasterCode(tenantId, {
      productName: product.name,
      variantAttributes: attrs,
      requested: item.code,
    });
    const sku = await MasterSku.create({
      tenantId,
      productId: product._id,
      code,
      name: item.name || product.name,
      variantAttributes: attrs,
      barcode: item.barcode || '',
      costPrice: item.costPrice || 0,
      mrp: item.mrp || 0,
      sellingPrice: item.sellingPrice || 0,
      weightKg: item.weightKg || 0,
      hsnCode: assertHsnCode(item.hsnCode || req.body.hsnCode),
      gstRatePercent: item.gstRatePercent ?? null,
      status: 'active',
      createdBy: userId,
    });
    created.push(sku);
  }
  await recordFromReq(req, {
    tenantId,
    action: 'sku.created',
    resourceType: 'products',
    resourceId: product._id,
    resourceDisplay: product.name,
    before: null,
    after: productSnap(product),
  });
  return successResponse(res, mapProduct(product, created), 'Product created', 201);
}

async function updateProduct(req, res) {
  const tenantId = merchantTenant(req);
  const product = await Product.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!product) throw new HttpError(404, 'Product not found');
  const before = productSnap(product);
  ['name', 'description', 'brand', 'category', 'status'].forEach((key) => {
    if (req.body[key] != null) product[key] = req.body[key];
  });
  if (req.body.hsnCode != null) product.hsnCode = assertHsnCode(req.body.hsnCode);
  if (req.body.gstRatePercent != null) product.gstRatePercent = req.body.gstRatePercent;
  if (req.body.images != null) product.images = normalizeImages(req.body.images);
  if (req.body.tags != null) product.tags = req.body.tags;
  product.updatedBy = req.user.id;
  await product.save();
  await recordFromReq(req, {
    tenantId,
    action: 'sku.updated',
    resourceType: 'products',
    resourceId: product._id,
    resourceDisplay: product.name,
    before,
    after: productSnap(product),
  });
  const variants = await MasterSku.find({ tenantId, productId: product._id }).setOptions({ skipTenantFilter: true });
  return successResponse(res, mapProduct(product, variants), 'Product updated');
}

async function getProduct(req, res) {
  const tenantId = merchantTenant(req);
  const product = await Product.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!product) throw new HttpError(404, 'Product not found');
  const variants = await MasterSku.find({ tenantId, productId: product._id }).setOptions({ skipTenantFilter: true });
  return successResponse(res, mapProduct(product, variants), 'Product');
}

async function addVariant(req, res) {
  const tenantId = merchantTenant(req);
  const product = await Product.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!product) throw new HttpError(404, 'Product not found');
  const attrs = req.body.variantAttributes || {};
  const code = await generateMasterCode(tenantId, {
    productName: product.name,
    variantAttributes: attrs,
    requested: req.body.code,
  });
  const sku = await MasterSku.create({
    tenantId,
    productId: product._id,
    code,
    name: req.body.name || product.name,
    variantAttributes: attrs,
    barcode: req.body.barcode || '',
    costPrice: req.body.costPrice || 0,
    mrp: req.body.mrp || 0,
    sellingPrice: req.body.sellingPrice || 0,
    hsnCode: assertHsnCode(req.body.hsnCode || product.hsnCode),
    gstRatePercent: req.body.gstRatePercent ?? product.gstRatePercent ?? null,
    status: 'active',
    createdBy: req.user.id,
  });
  const variants = await MasterSku.find({ tenantId, productId: product._id }).setOptions({ skipTenantFilter: true });
  return successResponse(res, { product: mapProduct(product, variants), variant: mapMaster(sku) }, 'Variant added', 201);
}

function normalizeImages(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'images must be a list');
  const out = [];
  for (const raw of list) {
    const value = String(raw || '').trim();
    if (!value) continue;
    if (!/^https?:\/\//i.test(value) && !value.startsWith('/uploads/')) {
      throw new HttpError(400, 'Image must be an http(s) URL or an uploaded file');
    }
    out.push(value);
  }
  if (out.length > 8) throw new HttpError(400, 'A product can have at most 8 images');
  return out;
}

async function deleteProduct(req, res) {
  const tenantId = merchantTenant(req);
  const product = await Product.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!product) throw new HttpError(404, 'Product not found');
  const skus = await MasterSku.find({ tenantId, productId: product._id }).setOptions({ skipTenantFilter: true });
  const skuIds = skus.map((sku) => sku._id);
  const [stock, maps, holds] = await Promise.all([
    skuIds.length ? Inventory.countDocuments({ tenantId, masterSkuId: { $in: skuIds } }).setOptions({ skipTenantFilter: true }) : 0,
    skuIds.length ? SkuMapping.countDocuments({ tenantId, masterSkuId: { $in: skuIds } }).setOptions({ skipTenantFilter: true }) : 0,
    skuIds.length ? InventoryReservation.countDocuments({ tenantId, masterSkuId: { $in: skuIds }, status: 'held' }).setOptions({ skipTenantFilter: true }) : 0,
  ]);
  if (stock || maps || holds) {
    product.status = 'archived';
    product.updatedBy = req.user.id;
    await product.save();
    if (skuIds.length) {
      await MasterSku.updateMany(
        { tenantId, productId: product._id },
        { $set: { status: 'discontinued', updatedBy: req.user.id } },
      ).setOptions({ skipTenantFilter: true });
    }
    const variants = await MasterSku.find({ tenantId, productId: product._id }).setOptions({ skipTenantFilter: true });
    return successResponse(res, mapProduct(product, variants), 'Product archived because stock or channel mappings exist');
  }
  if (skuIds.length) {
    await MasterSku.deleteMany({ tenantId, productId: product._id }).setOptions({ skipTenantFilter: true });
  }
  await Product.deleteOne({ _id: product._id, tenantId }).setOptions({ skipTenantFilter: true });
  return successResponse(res, { id: String(product._id), deleted: true }, 'Product deleted');
}

async function addImage(req, res) {
  const tenantId = merchantTenant(req);
  if (!req.file) throw new HttpError(400, 'Choose an image file');
  const product = await Product.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!product) throw new HttpError(404, 'Product not found');
  const imagePath = publicUploadPath(tenantId, req.file.filename);
  if ((product.images || []).length >= 8) throw new HttpError(400, 'A product can have at most 8 images');
  product.images = [...(product.images || []), imagePath];
  product.updatedBy = req.user.id;
  await product.save();
  const variants = await MasterSku.find({ tenantId, productId: product._id }).setOptions({ skipTenantFilter: true });
  return successResponse(res, mapProduct(product, variants), 'Image uploaded', 201);
}

module.exports = { listProducts, createProduct, updateProduct, getProduct, addVariant, deleteProduct, addImage, merchantTenant };
