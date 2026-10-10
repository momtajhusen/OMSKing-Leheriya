const User = require('../models/User');
const Role = require('../models/Role');
const Tenant = require('../models/Tenant');
const { HttpError } = require('../utils/httpError');
const { successResponse } = require('../utils/response');
const { publicUser, accessPayload } = require('../lib/userDto');
const { provisionMerchant } = require('../services/tenantOnboard.service');
const { sendMail, assertMailConfigured } = require('../lib/mailer');
const { accountCreatedEmail, mailboxTestEmail } = require('../lib/mailTemplates');
const { signAccessToken, signRefreshToken, verifyRefresh, setRefreshCookie, hashToken, deviceFromUa } = require('../lib/tokens');
const RefreshSession = require('../models/RefreshSession');
const crypto = require('crypto');
const Order = require('../models/Order');
const IntegrationJob = require('../models/IntegrationJob');
const { ensurePricing, quoteOrders } = require('../services/pricing.service');
const { orderPlacedMatch } = require('../services/subscription.service');
const { listPlatformJobs, requeueJob } = require('../services/jobQueue.service');
const platformSettings = require('../services/platformSettings.service');
const { recordFromReq } = require('../services/auditLog.service');

function mapTenant(t, userCount = 0, bill = null, lastSync = null) {
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
    lastSync: lastSync || null,
    ordersThisMonth: bill?.orders || 0,
    mrr: t.status === 'suspended' ? 0 : (bill?.bill || 0),
    planExpiresAt: t.planExpiresAt || null,
  };
}

async function billsByTenant() {
  const pricing = await ensurePricing();
  const counts = await Order.aggregate([
    { $match: { ...orderPlacedMatch(), status: { $nin: ['Cancelled', 'cancelled'] } } },
    { $group: { _id: '$tenantId', n: { $sum: 1 } } },
  ]);
  const byTenant = new Map(counts.map((row) => [String(row._id), row.n]));
  return { pricing, byTenant };
}

async function lastSyncByTenant() {
  const rows = await IntegrationJob.aggregate([
    { $match: { finishedAt: { $type: 'date' } } },
    { $group: { _id: '$tenantId', at: { $max: '$finishedAt' } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.at]));
}

async function listTenants(req, res) {
  const tenants = await Tenant.find({ kind: 'merchant' }).sort({ createdAt: -1 });
  const { pricing, byTenant } = await billsByTenant();
  const syncs = await lastSyncByTenant();
  const withCounts = await Promise.all(tenants.map(async (t) => {
    const n = await User.countDocuments({ tenantId: t._id }).setOptions({ skipTenantFilter: true });
    return mapTenant(t, n, quoteOrders(byTenant.get(String(t._id)) || 0, pricing), syncs.get(String(t._id)) || null);
  }));
  return successResponse(res, withCounts, 'Tenants');
}

async function createTenant(req, res) {
  await assertMailConfigured();
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
  const { pricing, byTenant } = await billsByTenant();
  const mail = accountCreatedEmail({
    name: req.body.ownerName || req.body.email.split('@')[0],
    email: String(req.body.email).toLowerCase(),
    password,
    roleLabel: 'Merchant Super Admin',
  });
  await sendMail({ to: String(req.body.email).toLowerCase(), ...mail });
  return successResponse(res, { ...mapTenant(tenant, n, quoteOrders(byTenant.get(String(tenant._id)) || 0, pricing)), temporaryPassword: password, emailSent: true }, 'Tenant created. Password sent to Gmail.', 201);
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
  const { pricing, byTenant } = await billsByTenant();
  return successResponse(res, mapTenant(tenant, n, quoteOrders(byTenant.get(String(tenant._id)) || 0, pricing)), 'Tenant updated');
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

async function listOpsJobs(req, res) {
  const rows = await listPlatformJobs({ failedOnly: false });
  return successResponse(res, rows, 'Platform jobs');
}

async function listOpsLogs(req, res) {
  const rows = await listPlatformJobs({ failedOnly: true });
  return successResponse(res, rows, 'Platform logs');
}

async function retryOpsJob(req, res) {
  const job = await IntegrationJob.findById(req.params.id).setOptions({ skipTenantFilter: true });
  if (!job) throw new HttpError(404, 'Job not found');
  const dto = await requeueJob(job.tenantId, req.user?.id, job._id);
  const tenant = await Tenant.findById(job.tenantId).setOptions({ skipTenantFilter: true });
  return successResponse(res, { ...dto, tenantId: String(job.tenantId), tenantName: tenant?.name || '' }, 'Job requeued');
}

async function getPublicConfig(req, res) {
  return successResponse(res, await platformSettings.publicPlatformSettings(), 'Public config');
}

async function getOpsSettings(req, res) {
  return successResponse(res, await platformSettings.getPlatformSettings(), 'Platform settings');
}

async function patchOpsSettings(req, res) {
  const { before, after } = await platformSettings.savePlatformSettings(req.body || {});
  await recordFromReq(req, {
    tenantId: req.user?.tenantId,
    action: 'platform.settings_updated',
    resourceType: 'platform_settings',
    resourceId: 'default',
    resourceDisplay: after.activeGmail || 'OMSKing settings',
    before,
    after,
  });
  return successResponse(res, after, 'Platform settings saved');
}

async function testOpsMail(req, res) {
  const user = await User.findById(req.user.id).setOptions({ skipTenantFilter: true });
  if (!user?.email) throw new HttpError(400, 'This account has no email');
  const letter = mailboxTestEmail();
  await sendMail({
    to: user.email,
    subject: letter.subject,
    text: letter.text,
    html: letter.html,
  });
  return successResponse(res, { sentTo: user.email }, 'Test email sent');
}

module.exports = {
  listTenants,
  createTenant,
  patchTenant,
  impersonate,
  listOpsJobs,
  listOpsLogs,
  retryOpsJob,
  getPublicConfig,
  getOpsSettings,
  patchOpsSettings,
  testOpsMail,
};
