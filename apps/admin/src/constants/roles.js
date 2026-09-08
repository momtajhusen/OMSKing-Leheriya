export const ROLES = Object.freeze({
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

export const ROLE_LABELS = Object.freeze({
  [ROLES.PLATFORM_ADMIN]: 'Platform Admin',
  [ROLES.SUPER_ADMIN]: 'Merchant Super Admin',
  [ROLES.OPERATIONS]: 'Operations',
  [ROLES.ADMIN]: 'Operations',
  [ROLES.WAREHOUSE]: 'Warehouse',
  [ROLES.ACCOUNTS]: 'Accounts',
  [ROLES.CATALOG_MANAGER]: 'Catalog Manager',
  [ROLES.CUSTOMER_SUPPORT]: 'Customer Support',
  [ROLES.VENDOR]: 'Vendor',
});

/** Merchant OMS chrome (not Platform Admin, not Vendor console). */
export const TENANT_STAFF_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.OPERATIONS,
  ROLES.ADMIN,
  ROLES.WAREHOUSE,
  ROLES.ACCOUNTS,
  ROLES.CATALOG_MANAGER,
  ROLES.CUSTOMER_SUPPORT,
];

export const MERCHANT_ASSIGNABLE_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.OPERATIONS,
  ROLES.WAREHOUSE,
  ROLES.ACCOUNTS,
  ROLES.CATALOG_MANAGER,
  ROLES.CUSTOMER_SUPPORT,
  ROLES.VENDOR,
];

export function homePathForRole(role) {
  if (role === ROLES.PLATFORM_ADMIN) return '/platform';
  if (role === ROLES.VENDOR) return '/vendor/orders';
  if (role === ROLES.WAREHOUSE) return '/inventory';
  if (role === ROLES.ACCOUNTS) return '/payment-reconciliation';
  if (role === ROLES.CATALOG_MANAGER) return '/products';
  if (role === ROLES.CUSTOMER_SUPPORT) return '/orders';
  return '/dashboard';
}

export function effectiveRoleOf(user) {
  if (!user) return null;
  return user.impersonating ? ROLES.SUPER_ADMIN : user.role;
}
