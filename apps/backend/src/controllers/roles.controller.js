const Role = require('../models/Role');
const { HttpError } = require('../utils/httpError');
const { successResponse } = require('../utils/response');
const { sessionTenantId, assertSameTenant } = require('../lib/tenantAccess');
const { PERMISSIONS } = require('../constants/permissions');

const ALLOWED = new Set(Object.values(PERMISSIONS));

async function listRoles(req, res) {
  const tenantId = sessionTenantId(req);
  if (!tenantId) throw new HttpError(400, 'No tenant on this session');
  const roles = await Role.find({ tenantId }).sort({ name: 1 }).setOptions({ skipTenantFilter: true });
  return successResponse(res, roles.map((r) => ({
    id: String(r._id),
    code: r.code,
    name: r.name,
    description: r.description,
    permissions: r.permissions,
    isSystem: r.isSystem,
  })), 'Roles');
}

async function updateRolePermissions(req, res) {
  const role = await Role.findById(req.params.id).setOptions({ skipTenantFilter: true });
  if (!role) throw new HttpError(404, 'Role not found');
  assertSameTenant(req, role.tenantId);
  if (role.code === 'super_admin') throw new HttpError(400, 'Super Admin permissions cannot be reduced');
  if (role.code === 'platform_admin') throw new HttpError(400, 'Platform Admin permissions are fixed');
  if (!Array.isArray(req.body.permissions)) throw new HttpError(400, 'permissions array required');
  const next = [...new Set(req.body.permissions.filter((key) => ALLOWED.has(key)))];
  if (role.code !== 'platform_admin' && next.includes(PERMISSIONS.TENANTS_MANAGE)) {
    throw new HttpError(400, 'tenants.manage is SaaS-only');
  }
  role.permissions = next;
  await role.save();
  return successResponse(res, {
    id: String(role._id),
    code: role.code,
    name: role.name,
    permissions: role.permissions,
  }, 'Role updated');
}

module.exports = { listRoles, updateRolePermissions };
