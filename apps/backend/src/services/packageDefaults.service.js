const Tenant = require('../models/Tenant');
const MasterSku = require('../models/MasterSku');
const { HttpError } = require('../utils/httpError');

const LABELS = { weightKg: 'Weight (kg)', lengthCm: 'Length (cm)', breadthCm: 'Breadth (cm)', heightCm: 'Height (cm)' };
const MAX = { weightKg: 1000, lengthCm: 1000, breadthCm: 1000, heightCm: 1000 };

function measure(value, key) {
  if (value == null || value === '') return 0;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > MAX[key]) {
    throw new HttpError(400, `${LABELS[key]} must be a number from 0 to ${MAX[key]}`);
  }
  return num;
}

function skuPackage(body) {
  const out = {};
  if (body.weightKg != null) out.weightKg = measure(body.weightKg, 'weightKg');
  if (body.dimensionsCm != null) {
    const dims = body.dimensionsCm || {};
    out.dimensionsCm = {
      l: measure(dims.l, 'lengthCm'),
      w: measure(dims.w, 'breadthCm'),
      h: measure(dims.h, 'heightCm'),
    };
  }
  return out;
}

function view(tenant) {
  const row = tenant?.settings?.packageDefaults || {};
  return {
    weightKg: Number(row.weightKg) || 0,
    lengthCm: Number(row.lengthCm) || 0,
    breadthCm: Number(row.breadthCm) || 0,
    heightCm: Number(row.heightCm) || 0,
  };
}

async function loadTenant(tenantId) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new HttpError(404, 'Tenant not found');
  return tenant;
}

async function getPackageDefaults(tenantId) {
  return view(await loadTenant(tenantId));
}

async function savePackageDefaults(tenantId, body) {
  const next = {
    weightKg: measure(body.weightKg, 'weightKg'),
    lengthCm: measure(body.lengthCm, 'lengthCm'),
    breadthCm: measure(body.breadthCm, 'breadthCm'),
    heightCm: measure(body.heightCm, 'heightCm'),
  };
  const tenant = await loadTenant(tenantId);
  const before = view(tenant);
  tenant.settings = tenant.settings || {};
  tenant.settings.packageDefaults = next;
  tenant.markModified('settings');
  await tenant.save();
  let appliedCount = 0;
  if (body.applyToAll === true) {
    const result = await MasterSku.updateMany(
      { tenantId },
      { weightKg: next.weightKg, dimensionsCm: { l: next.lengthCm, w: next.breadthCm, h: next.heightCm } },
    ).setOptions({ skipTenantFilter: true });
    appliedCount = result.modifiedCount || 0;
  }
  return { before, defaults: view(tenant), appliedCount };
}

function effectivePackage(sku, defaults) {
  const dims = sku?.dimensionsCm || {};
  const own = Number(sku?.weightKg) > 0 && Number(dims.l) > 0 && Number(dims.w) > 0 && Number(dims.h) > 0;
  if (own) {
    return { weightKg: Number(sku.weightKg), lengthCm: Number(dims.l), breadthCm: Number(dims.w), heightCm: Number(dims.h), source: 'product' };
  }
  return { ...view({ settings: { packageDefaults: defaults } }), source: 'default' };
}

const PACK_KEYS = ['weightKg', 'lengthCm', 'breadthCm', 'heightCm'];

function itemPackInput(body = {}) {
  const out = {};
  PACK_KEYS.forEach((key) => { out[key] = measure(body[key], key); });
  return out;
}

function itemPackage(item, sku, defaults) {
  const base = effectivePackage(sku, defaults);
  const own = item?.pack || {};
  if (!PACK_KEYS.some((key) => Number(own[key]) > 0)) return base;
  const out = {};
  PACK_KEYS.forEach((key) => { out[key] = Number(own[key]) > 0 ? Number(own[key]) : base[key]; });
  return { ...out, source: 'order' };
}

async function itemPackages(tenantId, items = []) {
  const defaults = view(await Tenant.findById(tenantId));
  const ids = items.map((item) => item.masterSkuId).filter(Boolean);
  const codes = items.map((item) => String(item.sku || '').trim().toUpperCase()).filter(Boolean);
  const skus = await MasterSku.find({ tenantId, $or: [{ _id: { $in: ids } }, { code: { $in: codes } }] })
    .setOptions({ skipTenantFilter: true })
    .lean();
  const byId = new Map(skus.map((sku) => [String(sku._id), sku]));
  const byCode = new Map(skus.map((sku) => [sku.code, sku]));
  return items.map((item) => {
    const sku = byId.get(String(item.masterSkuId)) || byCode.get(String(item.sku || '').trim().toUpperCase());
    return itemPackage(item, sku, defaults);
  });
}

async function orderPackage(tenantId, items = []) {
  const packs = await itemPackages(tenantId, items);
  let weightKg = 0;
  let lengthCm = 0;
  let breadthCm = 0;
  let heightCm = 0;
  items.forEach((item, index) => {
    const pack = packs[index];
    const qty = Number(item.qty) || 1;
    weightKg += pack.weightKg * qty;
    lengthCm = Math.max(lengthCm, pack.lengthCm);
    breadthCm = Math.max(breadthCm, pack.breadthCm);
    heightCm += pack.heightCm * qty;
  });
  if (!weightKg) return {};
  return { weightGrams: Math.round(weightKg * 1000), lengthCm, breadthCm, heightCm };
}

module.exports = { getPackageDefaults, savePackageDefaults, skuPackage, effectivePackage, itemPackInput, itemPackages, orderPackage };
