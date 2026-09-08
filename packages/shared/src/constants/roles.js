const ROLES = Object.freeze({
  PLATFORM_ADMIN: 'platform_admin',
  SUPER_ADMIN: 'super_admin',
  OPERATIONS: 'operations',
  ADMIN: 'admin',
  WAREHOUSE: 'warehouse',
  ACCOUNTS: 'accounts',
  CATALOG_MANAGER: 'catalog_manager',
  CUSTOMER_SUPPORT: 'customer_support',
  VENDOR: 'vendor',
});

const TENANT_ID = 'tenantId';

const TENANT_STAFF_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.OPERATIONS,
  ROLES.ADMIN,
  ROLES.WAREHOUSE,
  ROLES.ACCOUNTS,
  ROLES.CATALOG_MANAGER,
  ROLES.CUSTOMER_SUPPORT,
];

module.exports = {
  ROLES,
  TENANT_ID,
  TENANT_STAFF_ROLES,
};
