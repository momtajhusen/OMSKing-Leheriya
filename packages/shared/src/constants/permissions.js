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
});

function hasPermission(granted, key) {
  if (!key) return true;
  return Array.isArray(granted) && granted.includes(key);
}

module.exports = {
  PERMISSIONS,
  hasPermission,
};
