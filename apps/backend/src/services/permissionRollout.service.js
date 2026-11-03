const Tenant = require('../models/Tenant');
const Role = require('../models/Role');
const { PERMISSION_ROLLOUTS } = require('../constants/permissions');

const ROLLOUT_KEYS = Object.keys(PERMISSION_ROLLOUTS);

/** Gives each new permission key once to the roles that had that access before; an owner's later removal is kept. */
async function applyPermissionRollouts() {
  const tenants = await Tenant.find({}, { _id: 1 }).lean();
  for (const tenant of tenants) {
    for (const [key, codes] of Object.entries(PERMISSION_ROLLOUTS)) {
      await Role.updateMany(
        { tenantId: tenant._id, code: { $in: codes }, permissionRollouts: { $ne: key } },
        { $addToSet: { permissions: key, permissionRollouts: key } },
      ).setOptions({ skipTenantFilter: true });
    }
  }
}

module.exports = { applyPermissionRollouts, ROLLOUT_KEYS };
