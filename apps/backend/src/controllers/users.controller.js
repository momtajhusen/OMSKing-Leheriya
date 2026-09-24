const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Role = require('../models/Role');
const { HttpError } = require('../utils/httpError');
const { successResponse, paginatedResponse } = require('../utils/response');
const { sessionTenantId, assertSameTenant } = require('../lib/tenantAccess');
const { sendMail, assertMailConfigured } = require('../lib/mailer');
const { accountCreatedEmail } = require('../lib/mailTemplates');

function statusLabel(status) {
  if (status === 'disabled') return 'Inactive';
  if (status === 'invited') return 'Invited';
  return 'Active';
}

function mapUser(row) {
  return {
    id: String(row._id),
    name: row.fullName,
    email: row.email,
    role: row.roleId?.code,
    status: statusLabel(row.status),
    lastLogin: row.lastLoginAt || 'Never',
    tenant: row.tenantId?.name,
    createdAt: row.createdAt,
  };
}

async function listUsers(req, res) {
  const q = (req.query.q || '').toLowerCase();
  const filter = { tenantId: sessionTenantId(req) };
  if (!filter.tenantId) throw new HttpError(400, 'No tenant on this session');
  const users = await User.find(filter)
    .populate(['roleId', 'tenantId'])
    .sort({ createdAt: -1 })
    .setOptions({ skipTenantFilter: true });
  let data = users.map(mapUser);
  if (q) {
    data = data.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }
  return paginatedResponse(res, data, 1, data.length || 50, data.length, 'Users');
}

async function assertNotLastSuperAdmin(user, nextRoleCode, disabling = false) {
  const populated = user.roleId?.code
    ? user
    : await User.findById(user._id).populate('roleId').setOptions({ skipTenantFilter: true });
  const currentCode = populated.roleId?.code;
  if (currentCode !== 'super_admin') return;
  if (!disabling && nextRoleCode && nextRoleCode === 'super_admin') return;
  const superRole = await Role.findOne({ tenantId: user.tenantId, code: 'super_admin' }).setOptions({ skipTenantFilter: true });
  if (!superRole) return;
  const count = await User.countDocuments({
    tenantId: user.tenantId,
    roleId: superRole._id,
    status: { $ne: 'disabled' },
  }).setOptions({ skipTenantFilter: true });
  if (count <= 1) {
    throw new HttpError(400, 'Cannot remove or disable the last Super Admin');
  }
}

async function createUser(req, res) {
  const { name, email, role, password } = req.body;
  const tenantId = sessionTenantId(req);
  if (!tenantId) throw new HttpError(400, 'No tenant on this session');
  const roleDoc = await Role.findOne({ tenantId, code: role }).setOptions({ skipTenantFilter: true });
  if (!roleDoc) throw new HttpError(400, 'Unknown role');
  if (roleDoc.code === 'platform_admin' && req.user.role !== 'platform_admin') {
    throw new HttpError(400, 'Cannot assign Platform Admin');
  }
  if (roleDoc.code === 'platform_admin' && !req.skipTenantFilter) {
    throw new HttpError(400, 'Cannot assign Platform Admin on a merchant');
  }
  const exists = await User.findOne({ tenantId, email: email.toLowerCase() }).setOptions({ skipTenantFilter: true });
  if (exists) throw new HttpError(409, 'Email already exists on this tenant');
  assertMailConfigured();
  const temp = password || `Invite-${Math.random().toString(36).slice(2, 10)}A1`;
  const user = await User.create({
    tenantId,
    fullName: name,
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(temp, 10),
    roleId: roleDoc._id,
    status: password ? 'active' : 'invited',
  });
  const populated = await User.findById(user._id).populate(['roleId', 'tenantId']).setOptions({ skipTenantFilter: true });
  const mail = accountCreatedEmail({
    name,
    email: email.toLowerCase(),
    password: temp,
    roleLabel: roleDoc.name || role,
  });
  await sendMail({ to: email.toLowerCase(), ...mail });
  return successResponse(res, {
    ...mapUser(populated),
    temporaryPassword: password ? undefined : temp,
    emailSent: true,
  }, 'User invited. Password sent to Gmail.', 201);
}

async function updateUser(req, res) {
  const user = await User.findById(req.params.id).populate('roleId').setOptions({ skipTenantFilter: true });
  if (!user) throw new HttpError(404, 'User not found');
  assertSameTenant(req, user.tenantId);
  if (req.body.role) {
    const roleDoc = await Role.findOne({ tenantId: user.tenantId, code: req.body.role }).setOptions({ skipTenantFilter: true });
    if (!roleDoc) throw new HttpError(400, 'Unknown role');
    if (roleDoc.code === 'platform_admin' && req.user.role !== 'platform_admin') {
      throw new HttpError(400, 'Cannot assign Platform Admin');
    }
    if (roleDoc.code === 'platform_admin' && !req.skipTenantFilter) {
      throw new HttpError(400, 'Cannot assign Platform Admin on a merchant');
    }
    await assertNotLastSuperAdmin(user, req.body.role);
    user.roleId = roleDoc._id;
  }
  if (req.body.name) user.fullName = req.body.name;
  if (req.body.email) user.email = req.body.email.toLowerCase();
  await user.save();
  const populated = await User.findById(user._id).populate(['roleId', 'tenantId']).setOptions({ skipTenantFilter: true });
  return successResponse(res, mapUser(populated), 'User updated');
}

async function patchUserStatus(req, res) {
  const user = await User.findById(req.params.id).populate('roleId').setOptions({ skipTenantFilter: true });
  if (!user) throw new HttpError(404, 'User not found');
  assertSameTenant(req, user.tenantId);
  if (String(user._id) === String(req.user.id)) throw new HttpError(400, 'Cannot disable yourself');
  const nextStatus = req.body.status === 'disabled' || req.body.status === 'Inactive' ? 'disabled' : 'active';
  if (nextStatus === 'disabled') await assertNotLastSuperAdmin(user, null, true);
  user.status = nextStatus;
  await user.save();
  const populated = await User.findById(user._id).populate(['roleId', 'tenantId']).setOptions({ skipTenantFilter: true });
  return successResponse(res, mapUser(populated), 'Status updated');
}

module.exports = { listUsers, createUser, updateUser, patchUserStatus };
