/** Granular keys — screens and APIs check these, not role names. */
export const PERMISSIONS = Object.freeze({
  ORDERS_VIEW: 'orders.view',
  ORDERS_EDIT: 'orders.edit',
  ORDERS_CANCEL: 'orders.cancel',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',
  SHIPPING_GENERATE: 'shipping.generate',
  SHIPPING_CANCEL: 'shipping.cancel',
  RETURNS_APPROVE: 'returns.approve',
  FINANCE_VIEW: 'finance.view',
  FINANCE_RECONCILE: 'finance.reconcile',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  CATALOG_VIEW: 'catalog.view',
  CATALOG_EDIT: 'catalog.edit',
  CUSTOMERS_VIEW: 'customers.view',
  TENANTS_MANAGE: 'tenants.manage',
});

export const PERMISSION_CATALOG = [
  { key: PERMISSIONS.ORDERS_VIEW, label: 'View orders' },
  { key: PERMISSIONS.ORDERS_EDIT, label: 'Edit orders / fulfilment' },
  { key: PERMISSIONS.ORDERS_CANCEL, label: 'Cancel orders' },
  { key: PERMISSIONS.INVENTORY_VIEW, label: 'View inventory' },
  { key: PERMISSIONS.INVENTORY_ADJUST, label: 'Adjust stock / pick-pack' },
  { key: PERMISSIONS.SHIPPING_GENERATE, label: 'Generate labels / AWB' },
  { key: PERMISSIONS.SHIPPING_CANCEL, label: 'Cancel shipping label' },
  { key: PERMISSIONS.RETURNS_APPROVE, label: 'Approve returns' },
  { key: PERMISSIONS.FINANCE_VIEW, label: 'View payments' },
  { key: PERMISSIONS.FINANCE_RECONCILE, label: 'Reconcile finance' },
  { key: PERMISSIONS.USERS_MANAGE, label: 'Manage users' },
  { key: PERMISSIONS.SETTINGS_MANAGE, label: 'Manage tenant settings' },
  { key: PERMISSIONS.CATALOG_VIEW, label: 'View catalog / SKUs' },
  { key: PERMISSIONS.CATALOG_EDIT, label: 'Edit catalog / mappings' },
  { key: PERMISSIONS.CUSTOMERS_VIEW, label: 'View customers' },
];

const P = PERMISSIONS;

const ALL_TENANT = PERMISSION_CATALOG.map((item) => item.key);

const OPS_PERMS = [
  P.ORDERS_VIEW, P.ORDERS_EDIT, P.ORDERS_CANCEL,
  P.SHIPPING_GENERATE, P.SHIPPING_CANCEL,
  P.RETURNS_APPROVE, P.CUSTOMERS_VIEW, P.CATALOG_VIEW,
  P.INVENTORY_VIEW,
];

export const ROLE_PERMISSIONS = Object.freeze({
  platform_admin: [P.TENANTS_MANAGE, P.USERS_MANAGE, P.SETTINGS_MANAGE],
  super_admin: ALL_TENANT,
  operations: OPS_PERMS,
  admin: OPS_PERMS,
  warehouse: [
    P.ORDERS_VIEW, P.ORDERS_EDIT,
    P.INVENTORY_VIEW, P.INVENTORY_ADJUST,
    P.SHIPPING_GENERATE,
  ],
  accounts: [
    P.ORDERS_VIEW, P.FINANCE_VIEW, P.FINANCE_RECONCILE, P.CUSTOMERS_VIEW,
  ],
  catalog_manager: [
    P.CATALOG_VIEW, P.CATALOG_EDIT, P.INVENTORY_VIEW, P.ORDERS_VIEW,
  ],
  customer_support: [
    P.ORDERS_VIEW, P.CUSTOMERS_VIEW, P.RETURNS_APPROVE,
  ],
  vendor: [
    P.ORDERS_VIEW, P.ORDERS_EDIT, P.SHIPPING_GENERATE,
  ],
});

export const ROUTE_PERMISSION = Object.freeze({
  '/dashboard': null,
  '/orders': P.ORDERS_VIEW,
  '/fulfilment': P.ORDERS_EDIT,
  '/shipping': P.SHIPPING_GENERATE,
  '/vendors': P.ORDERS_EDIT,
  '/reports': P.FINANCE_VIEW,
  '/inventory': P.INVENTORY_VIEW,
  '/warehouses': P.INVENTORY_VIEW,
  '/returns': P.RETURNS_APPROVE,
  '/rto': P.RETURNS_APPROVE,
  '/ndr': P.RETURNS_APPROVE,
  '/products': P.CATALOG_VIEW,
  '/master-sku': P.CATALOG_VIEW,
  '/sku-mapping': P.CATALOG_EDIT,
  '/import': P.CATALOG_EDIT,
  '/gst-invoice': P.FINANCE_VIEW,
  '/payment-reconciliation': P.FINANCE_RECONCILE,
  '/returns-refunds-reconciliation': P.FINANCE_RECONCILE,
  '/notifications': P.SETTINGS_MANAGE,
  '/settings': P.SETTINGS_MANAGE,
  '/users-roles': P.USERS_MANAGE,
  '/audit-logs': P.USERS_MANAGE,
  '/channels': P.SETTINGS_MANAGE,
  '/integrations': P.SETTINGS_MANAGE,
  '/webhooks': P.SETTINGS_MANAGE,
  '/authentication': P.USERS_MANAGE,
  '/ui/showcase': P.SETTINGS_MANAGE,
});

export function normalizeRole(role) {
  if (role === 'admin') return 'operations';
  return role;
}

export function permissionsForRole(role) {
  const code = normalizeRole(role);
  return [...(ROLE_PERMISSIONS[code] || [])];
}

export function hasPermission(granted, key) {
  if (!key) return true;
  const list = Array.isArray(granted) ? granted : [];
  return list.includes(key);
}

export function attachPermissions(user) {
  if (!user) return user;
  if (Array.isArray(user.permissions) && user.permissions.length) return user;
  return { ...user, permissions: permissionsForRole(user.role) };
}
