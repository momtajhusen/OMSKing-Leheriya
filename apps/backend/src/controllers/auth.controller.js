const bcrypt = require('bcryptjs');
const { hashPassword } = require('../lib/password');
const crypto = require('crypto');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Role = require('../models/Role');
const RefreshSession = require('../models/RefreshSession');
const PasswordReset = require('../models/PasswordReset');
const { HttpError } = require('../utils/httpError');
const { successResponse } = require('../utils/response');
const { recordFromReq } = require('../services/auditLog.service');
const { publicUser, accessPayload } = require('../lib/userDto');
const {
  hashToken, signAccessToken, signRefreshToken, verifyRefresh,
  setRefreshCookie, clearRefreshCookie, deviceFromUa, COOKIE_NAME,
} = require('../lib/tokens');
const { provisionMerchant } = require('../services/tenantOnboard.service');
const { sendMail, assertMailConfigured, mailboxOf } = require('../lib/mailer');
const config = require('../config');
const { welcomeEmail, resetOtpEmail } = require('../lib/mailTemplates');
const { removeStoredUpload } = require('../middleware/uploadImage');

const POPULATE = [
  { path: 'roleId', options: { allowCrossTenant: true } },
  { path: 'tenantId', options: { allowCrossTenant: true } },
];

async function loadUserById(id) {
  return User.findById(id).populate(POPULATE).setOptions({ allowCrossTenant: true });
}

async function issueSession(req, res, user, extras = {}) {
  const tenant = extras.tenant || user.tenantId;
  const dto = publicUser(user, tenant, extras);
  const accessToken = signAccessToken(accessPayload(dto, { rv: user.refreshTokenVersion }));
  const refreshToken = signRefreshToken({ sub: String(user._id), sid: crypto.randomUUID(), rv: user.refreshTokenVersion });
  const decoded = verifyRefresh(refreshToken);
  const session = new RefreshSession({
    tenantId: user.tenantId._id || user.tenantId,
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    userAgent: req.headers['user-agent'] || '',
    ip: req.ip,
    device: deviceFromUa(req.headers['user-agent']),
    expiresAt: new Date(decoded.exp * 1000),
  });
  await session.save({ allowCrossTenant: true });
  setRefreshCookie(res, refreshToken);
  return { accessToken, user: dto };
}

function tenantOf(user) {
  return user?.tenantId && typeof user.tenantId === 'object' ? user.tenantId : null;
}

async function accountsForEmail(email) {
  return User.find({ email }).populate(POPULATE).setOptions({ skipTenantFilter: true });
}

function companyChoices(users) {
  return users.map((user) => {
    const tenant = tenantOf(user);
    return { slug: tenant?.slug || '', name: tenant?.name || 'Company' };
  }).filter((row) => row.slug);
}

function pickAccount(users, workspace) {
  const slug = String(workspace || '').trim().toLowerCase();
  if (slug) {
    const matches = users.filter((user) => String(tenantOf(user)?.slug || '') === slug);
    return matches.length === 1 ? matches[0] : null;
  }
  if (users.length > 1) {
    const err = new HttpError(409, 'This email is on more than one company. Choose which one.');
    err.data = { companies: companyChoices(users) };
    throw err;
  }
  return users[0] || null;
}

async function login(req, res) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = req.body.password || '';
  const users = await accountsForEmail(email);
  const matched = [];
  for (const row of users) {
    if (row.passwordHash && await bcrypt.compare(password, row.passwordHash)) matched.push(row);
  }
  if (!matched.length) throw new HttpError(401, 'Invalid email or password');
  const user = pickAccount(matched, req.body.workspace);
  if (!user) throw new HttpError(401, 'Invalid email or password');
  if (user.status === 'disabled') throw new HttpError(403, 'Account disabled');

  const tenant = user.tenantId;
  if (tenant.kind === 'merchant' && tenant.status === 'suspended') {
    throw new HttpError(403, 'This tenant is suspended');
  }
  if (tenant.kind === 'merchant' && tenant.status === 'trial' && tenant.planExpiresAt && new Date(tenant.planExpiresAt) < new Date()) {
    throw new HttpError(403, 'This 14-day trial has ended. Renew the plan to sign in.');
  }

  user.lastLoginAt = new Date();
  await user.save();
  const session = await issueSession(req, res, user);
  return successResponse(res, session, 'Signed in');
}

const DEMO_ACCOUNTS = {
  merchant: { email: 'superadmin@omsking.com', label: 'Merchant demo' },
  platform: { email: 'platform@omsking.com', label: 'Platform demo' },
  vendor: { email: 'vendor@omsking.com', label: 'Vendor demo' },
};

const PLANS = {
  starter: ['Shopify'],
  growth: ['Shopify', 'Amazon', 'Myntra'],
  enterprise: ['Shopify', 'Amazon', 'Myntra'],
};

async function demoLogin(req, res) {
  if (!config.demoLogin) throw new HttpError(404, 'Demo login is off');
  const account = DEMO_ACCOUNTS[String(req.body.kind || '')];
  if (!account) throw new HttpError(400, 'Choose merchant, platform, or vendor demo');
  const users = await accountsForEmail(account.email);
  const user = users[0];
  if (!user || user.status === 'disabled') throw new HttpError(404, 'Demo account is not ready. Seed the database first.');
  const tenant = user.tenantId;
  if (tenant?.kind === 'merchant' && tenant.status === 'suspended') throw new HttpError(403, 'This tenant is suspended');
  user.lastLoginAt = new Date();
  await user.save();
  const session = await issueSession(req, res, user);
  return successResponse(res, session, 'Demo signed in');
}

async function register(req, res) {
  const { name, email, company, password } = req.body;
  const plan = PLANS[req.body.plan] ? req.body.plan : 'starter';
  const { tenant, owner } = await provisionMerchant({
    name: company,
    ownerEmail: email,
    ownerName: name,
    password,
    status: 'trial',
    plan,
    channels: PLANS[plan],
  });
  const user = await loadUserById(owner._id);
  const session = await issueSession(req, res, user, { tenant });
  try {
    const mail = welcomeEmail({ name, email: email.toLowerCase() });
    await sendMail({ to: email.toLowerCase(), ...mail });
  } catch (err) {
    console.error('[MAIL] Welcome email failed:', err.message);
  }
  return successResponse(res, session, 'Merchant trial created', 201);
}

async function refresh(req, res) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) throw new HttpError(401, 'Refresh token missing');
  let decoded;
  try {
    decoded = verifyRefresh(token);
  } catch {
    throw new HttpError(401, 'Invalid or expired refresh token');
  }
  const session = await RefreshSession.findOne({ tokenHash: hashToken(token) }).setOptions({ skipTenantFilter: true });
  if (!session || session.revokedAt) throw new HttpError(401, 'Session revoked');
  const user = await loadUserById(decoded.sub);
  if (!user || user.status === 'disabled') throw new HttpError(401, 'Invalid session');
  if (decoded.rv !== user.refreshTokenVersion) throw new HttpError(401, 'Session expired');

  session.lastActiveAt = new Date();
  await session.save();

  const dto = publicUser(user, user.tenantId);
  const accessToken = signAccessToken(accessPayload(dto, { rv: user.refreshTokenVersion }));
  return successResponse(res, { accessToken, user: dto }, 'Token refreshed');
}

async function logout(req, res) {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    await RefreshSession.findOneAndUpdate(
      { tokenHash: hashToken(token) },
      { revokedAt: new Date() },
    ).setOptions({ skipTenantFilter: true });
  }
  clearRefreshCookie(res);
  return successResponse(res, null, 'Signed out');
}

async function currentDto(req) {
  const user = await loadUserById(req.user.id);
  if (!user) throw new HttpError(401, 'User not found');
  const extras = {};
  if (req.user.impersonating) {
    extras.impersonating = true;
    extras.roleCode = req.user.role;
    extras.permissions = req.user.permissions;
    extras.tenantId = req.user.tenantId;
    const tenant = await Tenant.findById(req.user.tenantId);
    extras.tenantName = tenant?.name;
    extras.tenant = tenant;
  }
  return publicUser(user, extras.tenant || user.tenantId, extras);
}

async function me(req, res) {
  return successResponse(res, await currentDto(req), 'Current user');
}

async function patchMe(req, res) {
  const user = await User.findById(req.user.id).setOptions({ skipTenantFilter: true });
  if (!user) throw new HttpError(401, 'User not found');
  if (typeof req.body.twoFactorEnabled === 'boolean' && user.twoFactorEnabled !== req.body.twoFactorEnabled) {
    const before = { twoFactorEnabled: Boolean(user.twoFactorEnabled) };
    user.twoFactorEnabled = req.body.twoFactorEnabled;
    await user.save();
    await recordFromReq(req, {
      tenantId: user.tenantId,
      action: 'auth.two_factor_updated',
      resourceType: 'users',
      resourceId: user._id,
      resourceDisplay: user.email,
      before,
      after: { twoFactorEnabled: user.twoFactorEnabled },
    });
  } else {
    await user.save();
  }
  const fresh = await loadUserById(user._id);
  return successResponse(res, publicUser(fresh, fresh.tenantId), 'Profile updated');
}

async function uploadMyAvatar(req, res) {
  if (!req.file) throw new HttpError(400, 'Choose a photo');
  const user = await User.findById(req.user.id).setOptions({ skipTenantFilter: true });
  if (!user) throw new HttpError(401, 'User not found');
  const folder = String(req.avatarFolder || req.tenantId || req.user.homeTenantId || 'platform');
  removeStoredUpload(user.avatarUrl, folder);
  user.avatarUrl = `/uploads/${folder}/${req.file.filename}`;
  await user.save();
  return successResponse(res, await currentDto(req), 'Profile photo updated');
}

async function clearMyAvatar(req, res) {
  const user = await User.findById(req.user.id).setOptions({ skipTenantFilter: true });
  if (!user) throw new HttpError(401, 'User not found');
  const folder = String(req.tenantId || req.user.homeTenantId || 'platform');
  removeStoredUpload(user.avatarUrl, folder);
  user.avatarUrl = '';
  await user.save();
  return successResponse(res, await currentDto(req), 'Profile photo removed');
}

async function forgotPassword(req, res) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const generic = { sent: true };
  const users = await accountsForEmail(email);
  const user = pickAccount(users, req.body.workspace);
  if (!user || user.status === 'disabled') {
    return successResponse(res, generic, 'If that Gmail is registered, an OTP was sent');
  }
  const box = await mailboxOf(user.tenantId?._id || user.tenantId);
  if (!box) {
    return successResponse(res, generic, 'If that Gmail is registered, an OTP was sent');
  }

  await PasswordReset.updateMany(
    { userId: user._id, usedAt: { $exists: false } },
    { usedAt: new Date() },
  ).setOptions({ skipTenantFilter: true });

  const otp = String(crypto.randomInt(100000, 1000000));
  await PasswordReset.create({
    tenantId: user.tenantId?._id || user.tenantId,
    userId: user._id,
    tokenHash: hashToken(`otp:${user._id}:${otp}`),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  const mail = resetOtpEmail({ name: user.fullName, otp });
  await sendMail({ to: email, tenantId: user.tenantId?._id || user.tenantId, ...mail });
  return successResponse(res, generic, 'If that Gmail is registered, an OTP was sent');
}

async function resetPassword(req, res) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const otp = String(req.body.otp || '').trim();
  const { password } = req.body;
  const users = await accountsForEmail(email);
  const user = pickAccount(users, req.body.workspace);
  if (!user) throw new HttpError(400, 'Invalid email or OTP');
  const row = await PasswordReset.findOne({
    userId: user._id,
    tokenHash: hashToken(`otp:${user._id}:${otp}`),
  }).setOptions({ skipTenantFilter: true });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new HttpError(400, 'OTP is invalid or expired. Request a new one.');
  }
  if (row.attempts >= 5) {
    row.usedAt = new Date();
    await row.save();
    throw new HttpError(400, 'Too many attempts. Request a new OTP.');
  }
  user.passwordHash = await hashPassword(password);
  user.refreshTokenVersion += 1;
  await user.save();
  row.usedAt = new Date();
  await row.save();
  await RefreshSession.updateMany(
    { userId: user._id, revokedAt: { $exists: false } },
    { revokedAt: new Date() },
  ).setOptions({ skipTenantFilter: true });
  return successResponse(res, null, 'Password updated. Sign in with the new password.');
}

async function exitImpersonation(req, res) {
  if (!req.user.impersonating) throw new HttpError(400, 'Not impersonating');
  const user = await loadUserById(req.user.id);
  const session = await issueSession(req, res, user);
  return successResponse(res, session, 'Returned to platform');
}

async function listPasswordResets(req, res) {
  const filter = req.skipTenantFilter ? {} : { tenantId: req.tenantId };
  const rows = await PasswordReset.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .setOptions({ skipTenantFilter: true });
  const userIds = [...new Set(rows.map((r) => String(r.userId)))];
  const users = await User.find({ _id: { $in: userIds } }).setOptions({ skipTenantFilter: true });
  const byId = Object.fromEntries(users.map((u) => [String(u._id), u]));
  const data = rows.map((r) => {
    const u = byId[String(r.userId)];
    let status = 'Pending';
    if (r.usedAt) status = 'Completed';
    else if (r.expiresAt < new Date()) status = 'Expired';
    return {
      id: String(r._id),
      user: u?.fullName || 'Unknown',
      email: u?.email || '',
      requestedAt: r.createdAt,
      expiresAt: r.expiresAt,
      status,
    };
  });
  return successResponse(res, data, 'Password resets');
}

module.exports = {
  login,
  demoLogin,
  register,
  refresh,
  logout,
  me,
  patchMe,
  uploadMyAvatar,
  clearMyAvatar,
  forgotPassword,
  resetPassword,
  exitImpersonation,
  listPasswordResets,
};
