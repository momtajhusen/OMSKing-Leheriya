const CourierAccount = require('../models/CourierAccount');
const { encryptObject, decryptObject } = require('../lib/secretBox');
const { HttpError } = require('../utils/httpError');
const {
  PLATFORM, OWN, CUSTOM_FIELDS, SECRET_KEYS, findPlatform, findOwn,
} = require('../constants/courierCatalog');

const CAPABILITIES = new Set(['forward', 'return', 'ndr']);

function publicCreds(creds) {
  const out = { ...(creds || {}) };
  Object.keys(out).forEach((key) => {
    if (SECRET_KEYS.has(key) && out[key]) out[key] = '';
  });
  return out;
}

function cleanCreds(incoming, prev) {
  const next = { ...(prev || {}) };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value == null) return;
    const text = String(value).trim();
    if (!text && SECRET_KEYS.has(key)) return;
    next[key] = text;
  });
  return next;
}

function hasSecret(creds) {
  return Object.entries(creds || {}).some(([key, value]) => SECRET_KEYS.has(key) && String(value || '').trim());
}

function missingLabels(fields, creds) {
  return (fields || [])
    .filter((field) => field.required && !String(creds[field.key] || '').trim())
    .map((field) => field.label);
}

function capabilitiesOf(list, fallback) {
  const picked = (Array.isArray(list) ? list : fallback || [])
    .map((item) => String(item).toLowerCase())
    .filter((item) => CAPABILITIES.has(item));
  return [...new Set(picked)];
}

function slugCode(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `custom-${base || 'courier'}`;
}

function toDto(row) {
  const creds = decryptObject(row.credentialsEnc);
  return {
    id: String(row._id),
    source: row.source,
    code: row.code,
    name: row.name,
    mode: row.mode,
    weightLabel: row.weightLabel,
    status: row.status,
    priority: row.priority,
    rateHalfKg: row.rateHalfKg,
    serviceability: row.serviceability,
    capabilities: row.capabilities || [],
    credentials: publicCreds(creds),
    hasSecrets: hasSecret(creds),
  };
}

function catalogPayload() {
  return {
    platform: PLATFORM,
    own: OWN,
    customFields: CUSTOM_FIELDS,
  };
}

async function activeCourierCreds(tenantId, code) {
  const rows = await CourierAccount.find({ tenantId, code, status: 'active' }).setOptions({ skipTenantFilter: true });
  const ready = rows
    .map((row) => ({ row, creds: decryptObject(row.credentialsEnc) }))
    .filter((item) => String(item.creds.apiToken || item.creds.token || '').trim());
  const own = ready.find((item) => item.row.source === 'own');
  return (own || ready[0] || { creds: {} }).creds;
}

async function listCouriers(tenantId) {
  const rows = await CourierAccount.find({ tenantId }).sort({ priority: 1, name: 1 }).setOptions({ skipTenantFilter: true });
  return { ...catalogPayload(), accounts: rows.map(toDto) };
}

function actorId(userId) {
  return userId || null;
}

async function createCourier(tenantId, userId, body) {
  const source = body.source === 'own' ? 'own' : 'platform';
  if (source === 'platform') return createPlatform(tenantId, userId, body);
  return createOwn(tenantId, userId, body);
}

async function createPlatform(tenantId, userId, body) {
  const known = findPlatform(String(body.code || ''));
  if (!known) throw new HttpError(400, 'Unknown courier');
  const existing = await CourierAccount.findOne({ tenantId, source: 'platform', code: known.code }).setOptions({ skipTenantFilter: true });
  if (existing) return updateCourier(tenantId, userId, existing._id, body);
  const row = new CourierAccount({
    tenantId,
    source: 'platform',
    code: known.code,
    name: known.name,
    mode: known.mode,
    weightLabel: known.weightLabel,
    status: body.status === 'inactive' ? 'inactive' : 'active',
    priority: numberOr(body.priority, known.priority),
    rateHalfKg: numberOr(body.rateHalfKg, known.rateHalfKg),
    serviceability: textOr(body.serviceability, known.serviceability),
    capabilities: [],
    createdBy: actorId(userId),
    updatedBy: actorId(userId),
  });
  await row.save();
  return toDto(row);
}

async function createOwn(tenantId, userId, body) {
  const code = String(body.code || '').trim();
  const known = code && code !== 'custom' ? findOwn(code) : null;
  if (code && code !== 'custom' && !known) throw new HttpError(400, 'Unknown courier');
  const name = String(body.name || known?.name || '').trim();
  if (name.length < 2) throw new HttpError(400, 'Courier name is required');
  const fields = known ? known.fields : CUSTOM_FIELDS;
  const creds = cleanCreds(body.credentials, {});
  const missing = missingLabels(fields, creds);
  if (missing.length) throw new HttpError(400, `${missing.join(', ')} required`);
  if (!hasSecret(creds)) throw new HttpError(400, 'API credentials are required');

  let finalCode = known ? known.code : slugCode(name);
  if (!known) {
    const taken = await CourierAccount.find({ tenantId, source: 'own', code: new RegExp(`^${finalCode}(-\\d+)?$`) }).setOptions({ skipTenantFilter: true });
    const codes = new Set(taken.map((row) => row.code));
    if (codes.has(finalCode)) {
      let n = 2;
      while (codes.has(`${finalCode}-${n}`)) n += 1;
      finalCode = `${finalCode}-${n}`;
    }
  } else {
    const existing = await CourierAccount.findOne({ tenantId, source: 'own', code: finalCode }).setOptions({ skipTenantFilter: true });
    if (existing) return updateCourier(tenantId, userId, existing._id, { ...body, credentials: body.credentials });
  }

  const row = new CourierAccount({
    tenantId,
    source: 'own',
    code: finalCode,
    name,
    mode: body.mode === 'air' ? 'air' : 'surface',
    weightLabel: textOr(body.weightLabel, '0.5kg'),
    status: body.status === 'inactive' ? 'inactive' : 'active',
    priority: numberOr(body.priority, 1),
    rateHalfKg: numberOr(body.rateHalfKg, 0),
    serviceability: textOr(body.serviceability, ''),
    capabilities: capabilitiesOf(body.capabilities, known?.capabilities || ['forward']),
    credentialsEnc: encryptObject(creds),
    createdBy: actorId(userId),
    updatedBy: actorId(userId),
  });
  await row.save();
  return toDto(row);
}

async function updateCourier(tenantId, userId, id, body) {
  const row = await CourierAccount.findOne({ _id: id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!row) throw new HttpError(404, 'Courier not found');
  if (body.status === 'active' || body.status === 'inactive') row.status = body.status;
  if (body.priority != null && body.priority !== '') row.priority = numberOr(body.priority, row.priority);
  if (body.rateHalfKg != null && body.rateHalfKg !== '') row.rateHalfKg = numberOr(body.rateHalfKg, row.rateHalfKg);
  if (body.serviceability != null) row.serviceability = String(body.serviceability).trim().slice(0, 120);
  if (body.mode === 'air' || body.mode === 'surface') row.mode = body.mode;
  if (body.name && row.code.startsWith('custom-')) {
    const name = String(body.name).trim();
    if (name.length < 2) throw new HttpError(400, 'Courier name is required');
    row.name = name;
  }
  if (Array.isArray(body.capabilities)) row.capabilities = capabilitiesOf(body.capabilities, row.capabilities);

  if (row.source === 'own' && body.credentials) {
    const known = findOwn(row.code);
    const fields = known ? known.fields : CUSTOM_FIELDS;
    const creds = cleanCreds(body.credentials, decryptObject(row.credentialsEnc));
    const missing = missingLabels(fields, creds);
    if (missing.length) throw new HttpError(400, `${missing.join(', ')} required`);
    if (!hasSecret(creds)) throw new HttpError(400, 'API credentials are required');
    row.credentialsEnc = encryptObject(creds);
  }

  row.updatedBy = actorId(userId);
  await row.save();
  return toDto(row);
}

async function removeCourier(tenantId, id) {
  const row = await CourierAccount.findOne({ _id: id, tenantId, source: 'own' }).setOptions({ skipTenantFilter: true });
  if (!row) throw new HttpError(404, 'Courier not found');
  await row.deleteOne();
  return { id: String(id) };
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function textOr(value, fallback) {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

module.exports = {
  listCouriers,
  createCourier,
  updateCourier,
  removeCourier,
  activeCourierCreds,
};
