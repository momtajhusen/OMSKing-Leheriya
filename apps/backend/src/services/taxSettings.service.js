const Tenant = require('../models/Tenant');
const MasterSku = require('../models/MasterSku');
const Product = require('../models/Product');
const { HttpError } = require('../utils/httpError');

const DEFAULT_TAX = {
  defaultGstRate: 18,
  categories: [
    { name: 'Clothing (Below ₹1000)', gstRate: 5 },
    { name: 'Clothing (Above ₹1000)', gstRate: 12 },
    { name: 'Premium Textiles', gstRate: 18 },
  ],
  hsnMaster: [],
};

function rateOrThrow(value, label) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new HttpError(400, `${label} must be between 0 and 100`);
  }
  return Math.round(rate * 100) / 100;
}

function view(tenant) {
  const tax = tenant?.settings?.taxGst;
  const storedCategories = Array.isArray(tax?.categories) ? tax.categories : null;
  const categories = (storedCategories && storedCategories.length ? storedCategories : DEFAULT_TAX.categories)
    .map((row) => ({
      name: String(row.name || '').trim(),
      gstRate: Number(row.gstRate) || 0,
    }))
    .filter((row) => row.name);
  const hsnMaster = (tax?.hsnMaster || []).map((row) => ({
    hsn: String(row.hsn || ''),
    description: String(row.description || ''),
    gstRate: row.gstRate == null ? null : Number(row.gstRate),
  }));
  return {
    defaultGstRate: tax && tax.defaultGstRate != null ? Number(tax.defaultGstRate) : DEFAULT_TAX.defaultGstRate,
    categories: categories.length ? categories : DEFAULT_TAX.categories.map((row) => ({ ...row })),
    hsnCount: hsnMaster.length,
    hsnMaster,
    saved: Boolean(tax?.configured),
  };
}

function publicView(snapshot) {
  return {
    defaultGstRate: snapshot.defaultGstRate,
    categories: snapshot.categories,
    hsnCount: snapshot.hsnCount,
    hsnMaster: snapshot.hsnMaster.slice(0, 50),
    saved: snapshot.saved,
  };
}

function auditView(snapshot) {
  return {
    defaultGstRate: snapshot.defaultGstRate,
    categories: snapshot.categories,
    hsnCount: snapshot.hsnCount,
  };
}

async function loadTenant(tenantId) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new HttpError(404, 'Tenant not found');
  return tenant;
}

function cleanCategories(list) {
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Add at least one tax category');
  if (list.length > 50) throw new HttpError(400, 'At most 50 tax categories');
  const seen = new Set();
  return list.map((row, index) => {
    const name = String(row?.name || '').trim().slice(0, 80);
    if (name.length < 2) throw new HttpError(400, `Category ${index + 1} needs a name`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new HttpError(400, `Duplicate category: ${name}`);
    seen.add(key);
    return { name, gstRate: rateOrThrow(row.gstRate, name) };
  });
}

function cleanHsnRows(list) {
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'HSN file has no rows');
  if (list.length > 2000) throw new HttpError(400, 'HSN file is limited to 2000 rows');
  const byHsn = new Map();
  list.forEach((row, index) => {
    const hsn = String(row?.hsn || '').replace(/\s/g, '');
    if (!/^\d{4,8}$/.test(hsn)) throw new HttpError(400, `Row ${index + 1}: HSN must be 4–8 digits`);
    const description = String(row?.description || '').trim().slice(0, 120);
    const gstRate = row?.gstRate == null || row.gstRate === '' ? null : rateOrThrow(row.gstRate, `Row ${index + 1} GST`);
    const sku = String(row?.sku || '').trim().toUpperCase();
    byHsn.set(hsn, { hsn, description, gstRate, sku });
  });
  return [...byHsn.values()];
}

async function getTax(tenantId) {
  return publicView(view(await loadTenant(tenantId)));
}

async function saveTax(tenantId, body) {
  const tenant = await loadTenant(tenantId);
  const before = auditView(view(tenant));
  tenant.settings = tenant.settings || {};
  tenant.settings.taxGst = tenant.settings.taxGst || {};
  tenant.settings.taxGst.defaultGstRate = rateOrThrow(body.defaultGstRate, 'Default GST rate');
  tenant.settings.taxGst.categories = cleanCategories(body.categories);
  tenant.settings.taxGst.configured = true;
  if (!Array.isArray(tenant.settings.taxGst.hsnMaster)) tenant.settings.taxGst.hsnMaster = [];
  tenant.markModified('settings');
  await tenant.save();
  const afterSnap = view(tenant);
  return { before, after: auditView(afterSnap), saved: publicView(afterSnap) };
}

async function uploadHsn(tenantId, rows) {
  const cleaned = cleanHsnRows(rows);
  const tenant = await loadTenant(tenantId);
  const beforeCount = (tenant.settings?.taxGst?.hsnMaster || []).length;
  tenant.settings = tenant.settings || {};
  const current = view(tenant);
  tenant.settings.taxGst = {
    configured: true,
    defaultGstRate: current.defaultGstRate,
    categories: current.categories,
    hsnMaster: cleaned.map(({ hsn, description, gstRate }) => ({ hsn, description, gstRate })),
  };
  tenant.markModified('settings');
  await tenant.save();

  const applied = [];
  const unmatched = [];
  for (const row of cleaned) {
    if (!row.sku) continue;
    const sku = await MasterSku.findOne({ tenantId, code: row.sku }).setOptions({ skipTenantFilter: true });
    if (!sku) {
      unmatched.push(row.sku);
      continue;
    }
    sku.hsnCode = row.hsn;
    if (row.gstRate != null) sku.gstRatePercent = row.gstRate;
    await sku.save();
    if (sku.productId) {
      const patch = { hsnCode: row.hsn };
      if (row.gstRate != null) patch.gstRatePercent = row.gstRate;
      await Product.updateOne({ _id: sku.productId, tenantId }, patch).setOptions({ skipTenantFilter: true });
    }
    applied.push(row.sku);
  }

  return {
    before: { hsnCount: beforeCount },
    after: {
      hsnCount: cleaned.length,
      applied: applied.slice(0, 30),
      unmatched: unmatched.slice(0, 30),
    },
    saved: publicView(view(tenant)),
    appliedCount: applied.length,
    unmatched,
  };
}

module.exports = { getTax, saveTax, uploadHsn, DEFAULT_TAX };
