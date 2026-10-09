const crypto = require('crypto');
const mongoose = require('mongoose');
const ApiKey = require('../models/ApiKey');
const Tenant = require('../models/Tenant');
const { HttpError } = require('../utils/httpError');
const { successResponse } = require('../utils/response');
const { sessionTenantId } = require('../lib/tenantAccess');
const couriers = require('../services/courierAccount.service');
const taxSettings = require('../services/taxSettings.service');
const { recordFromReq } = require('../services/auditLog.service');

function merchantTenant(req) {
  const tenantId = sessionTenantId(req);
  if (!tenantId || req.skipTenantFilter) throw new HttpError(400, 'Open a merchant tenant first');
  return tenantId;
}

function mapCompany(tenant) {
  const legal = tenant.legalEntity || {};
  return {
    companyName: tenant.name || '',
    gstin: legal.gstin || '',
    pan: legal.pan || '',
    address: legal.address || '',
    city: legal.city || '',
    district: legal.district || '',
    supportEmail: legal.email || '',
    supportPhone: legal.phone || '',
  };
}

async function getCompany(req, res) {
  const tenant = await Tenant.findById(merchantTenant(req));
  if (!tenant) throw new HttpError(404, 'Tenant not found');
  return successResponse(res, mapCompany(tenant), 'Company');
}

async function patchCompany(req, res) {
  const tenant = await Tenant.findById(merchantTenant(req));
  if (!tenant) throw new HttpError(404, 'Tenant not found');
  const before = mapCompany(tenant);
  const body = req.body || {};
  if (body.companyName != null) tenant.name = String(body.companyName).trim();
  tenant.legalEntity = tenant.legalEntity || {};
  if (body.gstin != null) tenant.legalEntity.gstin = String(body.gstin).trim().toUpperCase();
  if (body.pan != null) tenant.legalEntity.pan = String(body.pan).trim().toUpperCase();
  if (body.address != null) tenant.legalEntity.address = String(body.address).trim();
  if (body.city != null) tenant.legalEntity.city = String(body.city).trim();
  if (body.district != null) tenant.legalEntity.district = String(body.district).trim();
  if (body.supportEmail != null) tenant.legalEntity.email = String(body.supportEmail).trim().toLowerCase();
  if (body.supportPhone != null) tenant.legalEntity.phone = String(body.supportPhone).trim();
  tenant.markModified('legalEntity');
  await tenant.save();
  const after = mapCompany(tenant);
  await recordFromReq(req, {
    tenantId: tenant._id,
    action: 'company.updated',
    resourceType: 'company',
    resourceId: tenant._id,
    resourceDisplay: after.companyName,
    before,
    after,
  });
  return successResponse(res, after, 'Company saved');
}

async function getTax(req, res) {
  return successResponse(res, await taxSettings.getTax(merchantTenant(req)), 'Tax settings');
}

async function patchTax(req, res) {
  const tenantId = merchantTenant(req);
  const result = await taxSettings.saveTax(tenantId, req.body || {});
  await recordFromReq(req, {
    tenantId,
    action: 'tax.updated',
    resourceType: 'tax_gst',
    resourceId: tenantId,
    resourceDisplay: 'Tax & GST',
    before: result.before,
    after: result.after,
  });
  return successResponse(res, result.saved, 'Tax settings saved');
}

async function uploadHsn(req, res) {
  const tenantId = merchantTenant(req);
  const result = await taxSettings.uploadHsn(tenantId, req.body?.rows);
  await recordFromReq(req, {
    tenantId,
    action: 'tax.hsn_uploaded',
    resourceType: 'tax_gst',
    resourceId: tenantId,
    resourceDisplay: 'HSN master',
    before: result.before,
    after: result.after,
  });
  return successResponse(res, {
    ...result.saved,
    appliedCount: result.appliedCount,
    unmatched: result.unmatched,
  }, 'HSN master saved');
}

function mapKey(row) {
  return {
    id: String(row._id),
    label: row.label,
    prefix: row.prefix,
    scope: (row.scopes || []).join(', ') || 'Read',
    status: row.status === 'active' ? 'Active' : 'Inactive',
    createdAt: row.createdAt,
    lastUsed: row.lastUsedAt ? row.lastUsedAt : 'Never',
  };
}

async function listApiKeys(req, res) {
  const tenantId = merchantTenant(req);
  const rows = await ApiKey.find({ tenantId }).sort({ createdAt: -1 }).setOptions({ skipTenantFilter: true });
  return successResponse(res, rows.map(mapKey), 'API keys');
}

async function createApiKey(req, res) {
  const tenantId = merchantTenant(req);
  const label = String(req.body.label || '').trim();
  if (label.length < 2) throw new HttpError(400, 'Label is required');
  const secret = `oms_${crypto.randomBytes(24).toString('hex')}`;
  const prefix = `${secret.slice(0, 12)}…`;
  const keyHash = crypto.createHash('sha256').update(secret).digest('hex');
  const scopes = Array.isArray(req.body.scopes) && req.body.scopes.length ? req.body.scopes.map(String) : ['read'];
  const row = await ApiKey.create({
    tenantId,
    label,
    prefix,
    keyHash,
    scopes,
    status: 'active',
    createdBy: req.user.id && mongoose.Types.ObjectId.isValid(req.user.id) ? req.user.id : null,
  });
  const dto = mapKey(row);
  await recordFromReq(req, {
    tenantId,
    action: 'api_key.created',
    resourceType: 'api_keys',
    resourceId: row._id,
    resourceDisplay: dto.label,
    before: null,
    after: { label: dto.label, prefix: dto.prefix, status: dto.status },
  });
  return successResponse(res, { ...dto, secret }, 'Copy this key now. It will not be shown again.', 201);
}

async function revokeApiKey(req, res) {
  const tenantId = merchantTenant(req);
  const row = await ApiKey.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!row) throw new HttpError(404, 'API key not found');
  const before = mapKey(row);
  row.status = 'revoked';
  await row.save();
  const after = mapKey(row);
  await recordFromReq(req, {
    tenantId,
    action: 'api_key.revoked',
    resourceType: 'api_keys',
    resourceId: row._id,
    resourceDisplay: after.label,
    before: { label: before.label, status: before.status },
    after: { label: after.label, status: after.status },
  });
  return successResponse(res, after, 'API key revoked');
}

function courierSnap(row) {
  if (!row) return null;
  return {
    name: row.name,
    code: row.code,
    status: row.status,
    mode: row.mode,
    priority: row.priority,
    rateHalfKg: row.rateHalfKg,
    serviceability: row.serviceability,
  };
}

function actor(req) {
  return req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id) ? req.user.id : null;
}

async function listCouriers(req, res) {
  return successResponse(res, await couriers.listCouriers(merchantTenant(req)), 'Couriers');
}

async function createCourier(req, res) {
  const tenantId = merchantTenant(req);
  const existing = await couriers.listCouriers(tenantId);
  const body = req.body || {};
  const before = (existing.accounts || []).find((row) => row.source === body.source && row.code === body.code);
  const row = await couriers.createCourier(tenantId, actor(req), body);
  await recordFromReq(req, {
    tenantId,
    action: before ? 'courier.updated' : 'courier.created',
    resourceType: 'couriers',
    resourceId: row.id,
    resourceDisplay: row.name,
    before: courierSnap(before),
    after: courierSnap(row),
  });
  return successResponse(res, row, 'Courier saved', 201);
}

function courierId(req) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new HttpError(404, 'Courier not found');
  return req.params.id;
}

async function patchCourier(req, res) {
  const tenantId = merchantTenant(req);
  const id = courierId(req);
  const existing = await couriers.listCouriers(tenantId);
  const before = (existing.accounts || []).find((row) => row.id === String(id));
  const row = await couriers.updateCourier(tenantId, actor(req), id, req.body || {});
  await recordFromReq(req, {
    tenantId,
    action: 'courier.updated',
    resourceType: 'couriers',
    resourceId: row.id,
    resourceDisplay: row.name,
    before: courierSnap(before),
    after: courierSnap(row),
  });
  return successResponse(res, row, 'Courier saved');
}

async function removeCourier(req, res) {
  const tenantId = merchantTenant(req);
  const id = courierId(req);
  const existing = await couriers.listCouriers(tenantId);
  const before = (existing.accounts || []).find((row) => row.id === String(id));
  const row = await couriers.removeCourier(tenantId, id);
  await recordFromReq(req, {
    tenantId,
    action: 'courier.removed',
    resourceType: 'couriers',
    resourceId: id,
    resourceDisplay: before?.name || 'Courier',
    before: courierSnap(before),
    after: null,
  });
  return successResponse(res, row, 'Courier removed');
}

module.exports = {
  getCompany,
  patchCompany,
  getTax,
  patchTax,
  uploadHsn,
  listApiKeys,
  createApiKey,
  revokeApiKey,
  listCouriers,
  createCourier,
  patchCourier,
  removeCourier,
};
