const Product = require('../models/Product');
const MasterSku = require('../models/MasterSku');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
const { sessionTenantId } = require('../lib/tenantAccess');
const { generateMasterCode } = require('../services/skuIdentity.service');
const { mapProduct, mapMaster } = require('../services/catalogMapping.service');

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
    hsnCode: req.body.hsnCode || '',
    gstRatePercent: req.body.gstRatePercent ?? 5,
    images: req.body.images || [],
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
      hsnCode: item.hsnCode || '',
      gstRatePercent: item.gstRatePercent ?? null,
      status: 'active',
      createdBy: userId,
    });
    created.push(sku);
  }
  return successResponse(res, mapProduct(product, created), 'Product created', 201);
}

async function updateProduct(req, res) {
  const tenantId = merchantTenant(req);
  const product = await Product.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!product) throw new HttpError(404, 'Product not found');
  ['name', 'description', 'brand', 'category', 'hsnCode', 'status'].forEach((key) => {
    if (req.body[key] != null) product[key] = req.body[key];
  });
  if (req.body.gstRatePercent != null) product.gstRatePercent = req.body.gstRatePercent;
  product.updatedBy = req.user.id;
  await product.save();
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
    hsnCode: req.body.hsnCode || product.hsnCode || '',
    gstRatePercent: req.body.gstRatePercent ?? product.gstRatePercent ?? null,
    status: 'active',
    createdBy: req.user.id,
  });
  const variants = await MasterSku.find({ tenantId, productId: product._id }).setOptions({ skipTenantFilter: true });
  return successResponse(res, { product: mapProduct(product, variants), variant: mapMaster(sku) }, 'Variant added', 201);
}

module.exports = { listProducts, createProduct, updateProduct, getProduct, addVariant, merchantTenant };
