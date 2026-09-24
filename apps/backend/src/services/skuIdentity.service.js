const Tenant = require('../models/Tenant');
const MasterSku = require('../models/MasterSku');
const { HttpError } = require('../utils/httpError');

function slugPart(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12)
    .replace(/-+$/g, '');
}

function attrsToParts(attrs = {}) {
  const obj = attrs instanceof Map ? Object.fromEntries(attrs) : attrs;
  return ['color', 'size', 'design', 'fabric']
    .map((key) => slugPart(obj[key]))
    .filter(Boolean);
}

async function skuPrefix(tenantId) {
  const tenant = await Tenant.findById(tenantId);
  const raw = tenant?.settings?.skuPrefix || tenant?.slug || 'OMS';
  return slugPart(raw).slice(0, 4) || 'OMS';
}

async function generateMasterCode(tenantId, { productName, variantAttributes, requested } = {}) {
  if (requested) {
    const code = slugPart(requested);
    const clash = await MasterSku.findOne({ tenantId, code }).setOptions({ skipTenantFilter: true });
    if (clash) throw new HttpError(409, `Master SKU ${code} already exists`);
    return code;
  }
  const prefix = await skuPrefix(tenantId);
  const namePart = slugPart(productName).slice(0, 10) || 'SKU';
  const extra = attrsToParts(variantAttributes).join('-');
  let base = [prefix, namePart, extra].filter(Boolean).join('-');
  let code = base;
  let n = 2;
  while (await MasterSku.findOne({ tenantId, code }).setOptions({ skipTenantFilter: true })) {
    code = `${base}-${n}`;
    n += 1;
  }
  return code;
}

function normalizeSkuCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeBarcode(value) {
  return String(value || '').trim();
}

function normalizeChannel(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = {
  generateMasterCode,
  normalizeSkuCode,
  normalizeBarcode,
  normalizeChannel,
  slugPart,
};
