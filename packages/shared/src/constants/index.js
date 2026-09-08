const { ROLES, TENANT_ID, TENANT_STAFF_ROLES } = require('./roles');
const { PERMISSIONS, hasPermission } = require('./permissions');

module.exports = {
  ROLES,
  TENANT_ID,
  TENANT_STAFF_ROLES,
  PERMISSIONS,
  hasPermission,
};
