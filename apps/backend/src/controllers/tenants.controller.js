const User = require('../models/User');
const Role = require('../models/Role');
const Tenant = require('../models/Tenant');
const { HttpError } = require('../utils/httpError');
const { successResponse } = require('../utils/response');
const { publicUser, accessPayload } = require('../lib/userDto');
const { provisionMerchant } = require('../services/tenantOnboard.service');
const { sendMail, assertMailConfigured } = require('../lib/mailer');
const { accountCreatedEmail } = require('../lib/mailTemplates');
const { signAccessToken, signRefreshToken, verifyRefresh, setRefreshCookie, hashToken, deviceFromUa } = require('../lib/tokens');
const RefreshSession = require('../models/RefreshSession');
const crypto = require('crypto');

function mapTenant(t, userCount = 0) {
  const statusMap = { active: 'Active', trial: 'Trial', suspended: 'Suspended' };
  return {
    id: String(t._id),
    name: t.name,
    slug: t.slug,
    owner: t.legalEntity?.email || '',
    email: t.legalEntity?.email || '',
    status: statusMap[t.status] || t.status,
    plan: t.plan,
    channels: t.settings?.channels || [],
    users: userCount,
    lastSync: t.updatedAt,
    mrr: t.status === 'suspended' ? 0 : (t.plan === 'enterprise' ? 24999 : t.plan === 'growth' ? 9999 : 0),
  };
}

async function listTenants(req, res) {
  const tenants = await Tenant.find({ kind: 'merchant' }).sort({ createdAt: -1 });
  const withCounts = await Promise.all(tenants.map(async (t) => {
    const n = await User.countDocuments({ tenantId: t._id }).setOptions({ skipTenantFilter: true });
    return mapTenant(t, n);
  }));
  return successResponse(res, withCounts, 'Tenants');
}

async function createTenant(req, res) {
  assertMailConfigured();
  const password = req.body.password || `Welcome-${Math.random().toString(36).slice(2, 8)}A1`;
  const { tenant } = await provisionMerchant({
    name: req.body.name,
    slug: req.body.slug,
    ownerEmail: req.body.email,
    ownerName: req.body.ownerName || req.body.email.split('@')[0],
    password,
    plan: req.body.plan || 'growth',
    status: 'trial',
    channels: req.body.channels || [],
  });
  const n = await User.countDocuments({ tenantId: tenant._id }).setOptions({ skipTenantFilter: true });
  const mail = accountCreatedEmail({
    name: req.body.ownerName || req.body.email.split('@')[0],
    email: String(req.body.email).toLowerCase(),
    password,
    roleLabel: 'Merchant Super Admin',
  });
  await sendMail({ to: String(req.body.email).toLowerCase(), ...mail });
  return successResponse(res, { ...mapTenant(tenant, n), temporaryPassword: password, emailSent: true }, 'Tenant created. Password sent to Gmail.', 201);
}

async function patchTenant(req, res) {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant || tenant.kind !== 'merchant') throw new HttpError(404, 'Tenant not found');
  if (req.body.status) {
    const raw = String(req.body.status).toLowerCase();
    tenant.status = raw === 'inactive' || raw === 'suspended' ? 'suspended' : raw === 'trial' ? 'trial' : 'active';
  }
  if (req.body.plan) tenant.plan = req.body.plan;
  await tenant.save();
  const n = await User.countDocuments({ tenantId: tenant._id }).setOptions({ skipTenantFilter: true });
  return successResponse(res, mapTenant(tenant, n), 'Tenant updated');
}

async function impersonate(req, res) {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant || tenant.kind !== 'merchant') throw new HttpError(404, 'Tenant not found');
  if (tenant.status === 'suspended') throw new HttpError(403, 'Activate this tenant before opening it');

  const platformUser = await User.findById(req.user.id).populate(['roleId', 'tenantId']).setOptions({ skipTenantFilter: true });
  const superRole = await Role.findOne({ tenantId: tenant._id, code: 'super_admin' }).setOptions({ skipTenantFilter: true });
  const dto = publicUser(platformUser, tenant, {
    impersonating: true,
    roleCode: 'super_admin',
    permissions: superRole?.permissions || [],
    tenantId: String(tenant._id),
    tenantName: tenant.name,
  });
  const accessToken = signAccessToken(accessPayload(dto, { rv: platformUser.refreshTokenVersion }));
  const refreshToken = signRefreshToken({ sub: String(platformUser._id), sid: crypto.randomUUID(), rv: platformUser.refreshTokenVersion });
  const decoded = verifyRefresh(refreshToken);
  await RefreshSession.create({
    tenantId: platformUser.tenantId._id || platformUser.tenantId,
    userId: platformUser._id,
    tokenHash: hashToken(refreshToken),
    userAgent: req.headers['user-agent'] || '',
    ip: req.ip,
    device: deviceFromUa(req.headers['user-agent']),
    expiresAt: new Date(decoded.exp * 1000),
  });
  setRefreshCookie(res, refreshToken);
  return successResponse(res, { accessToken, user: dto }, `Opened ${tenant.name}`);
}

module.exports = { listTenants, createTenant, patchTenant, impersonate };
