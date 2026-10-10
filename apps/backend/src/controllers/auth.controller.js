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
const { provisionMerchant, slugify } = require('../services/tenantOnboard.service');
const { sendMail } = require('../lib/mailer');
const { issueEmailOtp, takeEmailOtp } = require('../lib/emailOtp');
const config = require('../config');
const { welcomeEmail } = require('../lib/mailTemplates');
const Warehouse = require('../models/Warehouse');
const WarehouseLocationMap = require('../models/WarehouseLocationMap');
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
  if (user.emailVerified === false) {
    const err = new HttpError(403, 'Enter the OTP sent to your email before signing in.');
    err.data = { verificationRequired: true, email: user.email };
    throw err;
  }

  const tenant = user.tenantId;
  if (tenant.kind === 'merchant' && tenant.status === 'suspended') {
    throw new HttpError(403, 'This tenant is suspended');
  }
  if (tenant.kind === 'merchant' && tenant.status === 'trial' && tenant.planExpiresAt && new Date(tenant.planExpiresAt) < new Date()) {
    const { expiredTrialMessage } = require('../services/subscription.service');
    throw new HttpError(403, await expiredTrialMessage(tenant));
  }

  if (user.twoFactorEnabled) {
    await issueEmailOtp({ user, purpose: 'login', required: true });
    return successResponse(res, { twoFactorRequired: true, email: user.email }, 'OTP sent to your email');
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

async function removeUnverifiedMerchant(tenantId) {
  await PasswordReset.deleteMany({ tenantId }).setOptions({ skipTenantFilter: true });
  await User.deleteMany({ tenantId }).setOptions({ skipTenantFilter: true });
  await Role.deleteMany({ tenantId }).setOptions({ skipTenantFilter: true });
  await Warehouse.deleteMany({ tenantId }).setOptions({ skipTenantFilter: true });
  await WarehouseLocationMap.deleteMany({ tenantId }).setOptions({ skipTenantFilter: true });
  await Tenant.deleteOne({ _id: tenantId });
}

async function register(req, res) {
  const { name, email, company, password } = req.body;
  const plan = PLANS[req.body.plan] ? req.body.plan : 'starter';
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const slug = slugify(company);
  const existing = await Tenant.findOne({ slug });
  if (existing) {
    const pending = await User.findOne({
      tenantId: existing._id,
      email: normalizedEmail,
      emailVerified: false,
    }).setOptions({ skipTenantFilter: true });
    if (!pending) throw new HttpError(409, 'A tenant with this slug already exists');
    pending.fullName = name;
    pending.passwordHash = await hashPassword(password);
    await pending.save();
    await issueEmailOtp({ user: pending, purpose: 'signup', platformOnly: true, required: true });
    return successResponse(res, { verificationRequired: true, email: pending.email }, 'OTP sent. Verify your email to finish.');
  }

  const { tenant, owner } = await provisionMerchant({
    name: company,
    ownerEmail: normalizedEmail,
    ownerName: name,
    password,
    status: 'trial',
    plan,
    channels: PLANS[plan],
    emailVerified: false,
  });
  const user = await loadUserById(owner._id);
  try {
    await issueEmailOtp({ user, purpose: 'signup', platformOnly: true, required: true });
  } catch (err) {
    await removeUnverifiedMerchant(tenant._id);
    throw err;
  }
  return successResponse(res, { verificationRequired: true, email: user.email }, 'OTP sent. Verify your email to finish.', 201);
}

async function verifyEmail(req, res) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const users = (await accountsForEmail(email)).filter((user) => user.emailVerified === false && user.status !== 'disabled');
  const user = pickAccount(users, req.body.workspace);
  if (!user) throw new HttpError(400, 'Invalid email or OTP');
  await takeEmailOtp({ user, purpose: 'signup', otp: String(req.body.otp || '').trim() });
  user.emailVerified = true;
  user.lastLoginAt = new Date();
  await user.save();
  try {
    const mail = welcomeEmail({ name: user.fullName, email: user.email });
    await sendMail({ to: user.email, ...mail });
  } catch (err) {
    console.error('[MAIL] Welcome email failed:', err.message);
  }
  const session = await issueSession(req, res, user);
  return successResponse(res, session, 'Email verified');
}

async function resendVerification(req, res) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const generic = { sent: true };
  const users = (await accountsForEmail(email)).filter((user) => user.emailVerified === false && user.status !== 'disabled');
  const user = users.length ? pickAccount(users, req.body.workspace) : null;
  if (!user) return successResponse(res, generic, 'If that email is waiting for verification, an OTP was sent');
  await issueEmailOtp({ user, purpose: 'signup', platformOnly: true, required: true });
  return successResponse(res, generic, 'If that email is waiting for verification, an OTP was sent');
}

async function verifyLogin(req, res) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = req.body.password || '';
  const users = await accountsForEmail(email);
  const matched = [];
  for (const row of users) {
    if (row.passwordHash && await bcrypt.compare(password, row.passwordHash)) matched.push(row);
  }
  if (!matched.length) throw new HttpError(401, 'Invalid email or password');
  const user = pickAccount(matched, req.body.workspace);
  if (!user || user.status === 'disabled') throw new HttpError(401, 'Invalid email or password');
  if (!user.twoFactorEnabled) throw new HttpError(400, 'Sign-in OTP is not turned on for this account');
  await takeEmailOtp({ user, purpose: 'login', otp: String(req.body.otp || '').trim() });
  const tenant = user.tenantId;
  if (tenant.kind === 'merchant' && tenant.status === 'suspended') throw new HttpError(403, 'This tenant is suspended');
  user.lastLoginAt = new Date();
  await user.save();
  const session = await issueSession(req, res, user);
  return successResponse(res, session, 'Signed in');
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
  if (req.body.twoFactorEnabled === true) {
    throw new HttpError(400, 'Enter the OTP from Gmail to turn on sign-in verification.');
  }
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
  const sent = await issueEmailOtp({ user, purpose: 'reset' });
  if (!sent) return successResponse(res, generic, 'If that Gmail is registered, an OTP was sent');
  return successResponse(res, generic, 'If that Gmail is registered, an OTP was sent');
}

async function resetPassword(req, res) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const otp = String(req.body.otp || '').trim();
  const { password } = req.body;
  const users = await accountsForEmail(email);
  const user = pickAccount(users, req.body.workspace);
  if (!user) throw new HttpError(400, 'Invalid email or OTP');
  await takeEmailOtp({ user, purpose: 'reset', otp });
  user.passwordHash = await hashPassword(password);
  user.refreshTokenVersion += 1;
  await user.save();
  await RefreshSession.updateMany(
    { userId: user._id, revokedAt: { $exists: false } },
    { revokedAt: new Date() },
  ).setOptions({ skipTenantFilter: true });
  return successResponse(res, null, 'Password updated. Sign in with the new password.');
}

async function startTwoFactor(req, res) {
  const user = await loadUserById(req.user.id);
  if (!user || user.status === 'disabled') throw new HttpError(401, 'User not found');
  if (user.twoFactorEnabled) return successResponse(res, { twoFactorEnabled: true }, 'Sign-in OTP is already on');
  await issueEmailOtp({ user, purpose: 'enable-2fa', required: true });
  return successResponse(res, { sent: true }, 'OTP sent to your email');
}

async function confirmTwoFactor(req, res) {
  const user = await loadUserById(req.user.id);
  if (!user || user.status === 'disabled') throw new HttpError(401, 'User not found');
  await takeEmailOtp({ user, purpose: 'enable-2fa', otp: String(req.body.otp || '').trim() });
  const before = { twoFactorEnabled: Boolean(user.twoFactorEnabled) };
  user.twoFactorEnabled = true;
  await user.save();
  await recordFromReq(req, {
    tenantId: user.tenantId?._id || user.tenantId,
    action: 'auth.two_factor_updated',
    resourceType: 'users',
    resourceId: user._id,
    resourceDisplay: user.email,
    before,
    after: { twoFactorEnabled: true },
  });
  const fresh = await loadUserById(user._id);
  return successResponse(res, publicUser(fresh, fresh.tenantId), 'Sign-in OTP is on');
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
  verifyEmail,
  resendVerification,
  verifyLogin,
  startTwoFactor,
  confirmTwoFactor,
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
