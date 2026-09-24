const PERMISSIONS = Object.freeze({
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
  VENDORS_MANAGE: 'vendors.manage',
});

function hasPermission(granted, key) {
  if (!key) return true;
  return Array.isArray(granted) && granted.includes(key);
}

const P = PERMISSIONS;

const ALL_TENANT = [
  P.ORDERS_VIEW, P.ORDERS_EDIT, P.ORDERS_CANCEL,
  P.INVENTORY_VIEW, P.INVENTORY_ADJUST,
  P.SHIPPING_GENERATE, P.SHIPPING_CANCEL,
  P.RETURNS_APPROVE,
  P.FINANCE_VIEW, P.FINANCE_RECONCILE,
  P.USERS_MANAGE, P.SETTINGS_MANAGE,
  P.CATALOG_VIEW, P.CATALOG_EDIT, P.CUSTOMERS_VIEW,
  P.VENDORS_MANAGE,
];

const OPS = [
  P.ORDERS_VIEW, P.ORDERS_EDIT, P.ORDERS_CANCEL,
  P.SHIPPING_GENERATE, P.SHIPPING_CANCEL,
  P.RETURNS_APPROVE, P.CUSTOMERS_VIEW, P.CATALOG_VIEW, P.INVENTORY_VIEW,
  P.VENDORS_MANAGE,
];

const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  platform_admin: [P.TENANTS_MANAGE, P.USERS_MANAGE, P.SETTINGS_MANAGE],
  super_admin: ALL_TENANT,
  operations: OPS,
  admin: OPS,
  warehouse: [P.ORDERS_VIEW, P.ORDERS_EDIT, P.INVENTORY_VIEW, P.INVENTORY_ADJUST, P.SHIPPING_GENERATE],
  accounts: [P.ORDERS_VIEW, P.FINANCE_VIEW, P.FINANCE_RECONCILE, P.CUSTOMERS_VIEW],
  catalog_manager: [P.CATALOG_VIEW, P.CATALOG_EDIT, P.INVENTORY_VIEW, P.ORDERS_VIEW],
  customer_support: [P.ORDERS_VIEW, P.CUSTOMERS_VIEW, P.RETURNS_APPROVE],
  vendor: [P.ORDERS_VIEW, P.ORDERS_EDIT, P.SHIPPING_GENERATE],
});

const TENANT_ROLE_SEED = [
  { code: 'super_admin', name: 'Merchant Super Admin', description: 'Full access inside this tenant' },
  { code: 'operations', name: 'Operations', description: 'Orders, fulfilment, shipping, vendors' },
  { code: 'warehouse', name: 'Warehouse', description: 'Inventory, pick, pack, dispatch' },
  { code: 'accounts', name: 'Accounts', description: 'Payments and reconciliation' },
  { code: 'catalog_manager', name: 'Catalog Manager', description: 'Products, SKUs, mappings' },
  { code: 'customer_support', name: 'Customer Support', description: 'Orders, customers, returns' },
  { code: 'vendor', name: 'Vendor', description: 'Assigned orders and dispatch only' },
];

module.exports = {
  PERMISSIONS,
  hasPermission,
  ROLE_DEFAULT_PERMISSIONS,
  TENANT_ROLE_SEED,
};
