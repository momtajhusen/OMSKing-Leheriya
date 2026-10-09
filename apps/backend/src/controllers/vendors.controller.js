const mongoose = require('mongoose');
const Vendor = require('../models/Vendor');
const Order = require('../models/Order');
const User = require('../models/User');
const Role = require('../models/Role');
const RefreshSession = require('../models/RefreshSession');
const { hashPassword } = require('../lib/password');
const { HttpError } = require('../utils/httpError');
const { successResponse } = require('../utils/response');
const { merchantTenant } = require('./products.controller');
const { recordFromReq } = require('../services/auditLog.service');

const FIELDS = ['location', 'phone', 'email', 'telegramGroup'];

function norm(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cleanName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name || /^(null|void|undefined|n\/a|—|-)$/i.test(name)) return '';
  return name.slice(0, 120);
}

function toDto(row, counts = new Map()) {
  return {
    id: String(row._id),
    name: row.name,
    reportName: row.name,
    location: row.location || '',
    phone: row.phone || '',
    email: row.email || '',
    telegramGroup: row.telegramGroup || '',
    status: row.status,
    source: row.source,
    removed: Boolean(row.removed),
    assignedOrders: counts.get(row.nameNorm) || 0,
    createdAt: row.createdAt,
  };
}

/** Sub-order lines per vendor name, counted from real orders. */
async function assignedCounts(tenantId) {
  const rows = await Order.aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)) } },
    { $unwind: '$subOrders' },
    { $match: { 'subOrders.assignedVendor': { $nin: ['', null] } } },
    { $group: { _id: { $toLower: '$subOrders.assignedVendor' }, n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [norm(r._id), r.n]));
}

async function listVendors(req, res) {
  const tenantId = merchantTenant(req);
  const filter = { tenantId };
  if (req.vendorScope?.active) filter._id = { $in: req.vendorScope.assignedVendorIds };
  const [rows, counts] = await Promise.all([
    Vendor.find(filter).sort({ removed: 1, name: 1 }).setOptions({ skipTenantFilter: true }),
    assignedCounts(tenantId),
  ]);
  return successResponse(res, rows.map((row) => toDto(row, counts)), 'Vendors');
}

async function createVendor(req, res) {
  const tenantId = merchantTenant(req);
  const name = cleanName(req.body.name);
  if (!name) throw new HttpError(400, 'Vendor name is required');
  const existing = await Vendor.findOne({ tenantId, nameNorm: norm(name) }).setOptions({ skipTenantFilter: true });
  if (existing && !existing.removed) throw new HttpError(409, `${name} already exists`);
  const row = existing || new Vendor({ tenantId, nameNorm: norm(name), createdBy: req.user?.id });
  row.name = name;
  row.removed = false;
  row.status = 'Active';
  row.source = req.body.source === 'shopify' ? 'shopify' : 'manual';
  FIELDS.forEach((key) => { if (req.body[key] != null) row[key] = String(req.body[key]).trim(); });
  await row.save();
  return successResponse(res, toDto(row, await assignedCounts(tenantId)), 'Vendor saved', 201);
}

/** Vendor-role user updates the vendor row linked to this login. */
async function updateMe(req, res) {
  const tenantId = merchantTenant(req);
  if (!req.vendorScope?.active) throw new HttpError(400, 'This endpoint is for vendor logins');
  const ids = req.vendorScope.assignedVendorIds || [];
  if (!ids.length) throw new HttpError(404, 'No vendor profile is linked to this login');
  req.params.id = String(ids[0]);
  return updateVendor(req, res);
}

function assertOwnVendor(req, row) {
  if (!req.vendorScope?.active) return;
  const ids = (req.vendorScope.assignedVendorIds || []).map(String);
  if (!ids.includes(String(row._id))) throw new HttpError(404, 'Vendor not found');
}

async function updateVendor(req, res) {
  const tenantId = merchantTenant(req);
  const row = await Vendor.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!row) throw new HttpError(404, 'Vendor not found');
  assertOwnVendor(req, row);
  if (req.body.name != null) {
    const name = cleanName(req.body.name);
    if (!name) throw new HttpError(400, 'Vendor name is required');
    const clash = await Vendor.findOne({ tenantId, nameNorm: norm(name), _id: { $ne: row._id } })
      .setOptions({ skipTenantFilter: true });
    if (clash) throw new HttpError(409, `${name} already exists`);
    row.name = name;
    row.nameNorm = norm(name);
  }
  if (req.body.status != null) {
    if (!['Active', 'Inactive'].includes(req.body.status)) throw new HttpError(400, 'Status must be Active or Inactive');
    row.status = req.body.status;
  }
  FIELDS.forEach((key) => { if (req.body[key] != null) row[key] = String(req.body[key]).trim(); });
  await row.save();
  return successResponse(res, toDto(row, await assignedCounts(tenantId)), 'Vendor updated');
}

function assertLoginPassword(password) {
  const value = String(password || '');
  if (value.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (!/[A-Z]/.test(value)) throw new HttpError(400, 'Add at least one uppercase letter');
  if (!/[a-z]/.test(value)) throw new HttpError(400, 'Add at least one lowercase letter');
  if (!/[0-9]/.test(value)) throw new HttpError(400, 'Add at least one number');
  return value;
}

/** Super Admin sets the vendor portal login. Blank is not accepted here; the UI leaves the field empty to skip. */
async function setVendorPassword(req, res) {
  if (req.user?.role !== 'super_admin') {
    throw new HttpError(403, 'Only a Super Admin can change a vendor login password');
  }
  const tenantId = merchantTenant(req);
  const row = await Vendor.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!row) throw new HttpError(404, 'Vendor not found');
  if (row.removed) throw new HttpError(400, 'Restore this vendor before setting a login password');
  const password = assertLoginPassword(req.body.password);
  const email = String(row.email || '').trim().toLowerCase();

  let user = await User.findOne({ tenantId, assignedVendorIds: row._id }).setOptions({ skipTenantFilter: true });
  if (!user && email) {
    user = await User.findOne({ tenantId, email }).setOptions({ skipTenantFilter: true });
  }

  if (user) {
    const populated = await User.findById(user._id).populate('roleId').setOptions({ skipTenantFilter: true });
    if (populated.roleId?.code && populated.roleId.code !== 'vendor') {
      throw new HttpError(409, 'That email belongs to a staff login. Change staff passwords from Users.');
    }
    populated.passwordHash = await hashPassword(password);
    populated.refreshTokenVersion = (populated.refreshTokenVersion || 0) + 1;
    if (populated.status === 'invited') populated.status = 'active';
    if (!(populated.assignedVendorIds || []).some((id) => String(id) === String(row._id))) {
      populated.assignedVendorIds.push(row._id);
    }
    await populated.save();
    await RefreshSession.updateMany(
      { userId: populated._id, revokedAt: { $exists: false } },
      { revokedAt: new Date() },
    ).setOptions({ skipTenantFilter: true });
    await recordFromReq(req, {
      tenantId,
      action: 'vendor.password_set',
      resourceType: 'vendors',
      resourceId: row._id,
      resourceDisplay: populated.email,
      before: { login: 'previous' },
      after: { login: 'updated' },
    });
    return successResponse(res, { email: populated.email, created: false }, 'Vendor password updated');
  }

  if (!email) throw new HttpError(400, 'Add an email on this vendor before setting a login password');
  const role = await Role.findOne({ tenantId, code: 'vendor' }).setOptions({ skipTenantFilter: true });
  if (!role) throw new HttpError(400, 'Vendor role is not set up on this workspace');
  const created = await User.create({
    tenantId,
    fullName: row.name,
    email,
    passwordHash: await hashPassword(password),
    roleId: role._id,
    status: 'active',
    assignedVendorIds: [row._id],
  });
  await recordFromReq(req, {
    tenantId,
    action: 'vendor.password_set',
    resourceType: 'vendors',
    resourceId: row._id,
    resourceDisplay: created.email,
    before: { login: 'none' },
    after: { login: 'created' },
  });
  return successResponse(res, { email: created.email, created: true }, 'Vendor login created', 201);
}

/** Soft delete: old orders keep the vendor name for reports. */
async function removeVendor(req, res) {
  const tenantId = merchantTenant(req);
  const row = await Vendor.findOne({ _id: req.params.id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!row) throw new HttpError(404, 'Vendor not found');
  assertOwnVendor(req, row);
  row.removed = true;
  row.status = 'Inactive';
  await row.save();
  return successResponse(res, toDto(row, await assignedCounts(tenantId)), 'Vendor removed');
}

/** Bulk add names (e.g. from Shopify product vendors); existing names are skipped. */
async function importVendors(req, res) {
  const tenantId = merchantTenant(req);
  const names = [...new Set((req.body.names || []).map(cleanName).filter(Boolean))];
  let added = 0;
  for (const name of names) {
    const existing = await Vendor.findOne({ tenantId, nameNorm: norm(name) }).setOptions({ skipTenantFilter: true });
    if (existing) continue;
    await Vendor.create({
      tenantId,
      name,
      nameNorm: norm(name),
      source: req.body.source === 'shopify' ? 'shopify' : 'manual',
      createdBy: req.user?.id,
    });
    added += 1;
  }
  return successResponse(res, { added }, `${added} vendors added`);
}

/** Contact details for a vendor name, used when a sub-order is assigned. */
async function vendorByName(tenantId, name) {
  if (!name) return null;
  return Vendor.findOne({ tenantId, nameNorm: norm(name), removed: false }).setOptions({ skipTenantFilter: true });
}

/** Vendor names a vendor-role user may see. */
async function scopedVendorNames(tenantId, assignedVendorIds = []) {
  if (!assignedVendorIds.length) return [];
  const rows = await Vendor.find({ tenantId, _id: { $in: assignedVendorIds } }).setOptions({ skipTenantFilter: true });
  return rows.map((row) => row.name);
}

module.exports = {
  listVendors,
  createVendor,
  updateVendor,
  setVendorPassword,
  updateMe,
  removeVendor,
  importVendors,
  vendorByName,
  scopedVendorNames,
};
