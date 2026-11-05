import test from 'node:test';
import assert from 'node:assert/strict';
import { TENANT_STAFF_ROLES } from '../constants/roles.js';
import { ROLE_PERMISSIONS, PERMISSION_CATALOG } from '../constants/permissions.js';
import { accessDecision, homePathFor } from './routeAccess.js';
import { sameCompanySnapshot } from './companyList.js';

const vendor = ROLE_PERMISSIONS.vendor;

test('vendor is sent away from /dashboard and /users-roles', () => {
  for (const pathname of ['/dashboard', '/users-roles']) {
    const decision = accessDecision({
      isAuthenticated: true,
      role: 'vendor',
      pathname,
      permissions: vendor,
      requiredRoles: TENANT_STAFF_ROLES,
    });
    assert.equal(decision.redirectTo, '/vendor/orders');
  }
});

test('operations can open orders, pack and ship, and is sent away from admin screens', () => {
  const ops = ROLE_PERMISSIONS.operations;
  for (const pathname of ['/orders', '/fulfilment', '/shipping']) {
    const decision = accessDecision({
      isAuthenticated: true,
      role: 'operations',
      pathname,
      permissions: ops,
      requiredRoles: TENANT_STAFF_ROLES,
    });
    assert.equal(decision.redirectTo, null, pathname);
  }
  for (const pathname of ['/settings', '/setup', '/subscription', '/users-roles', '/payment-reconciliation', '/reports']) {
    const decision = accessDecision({
      isAuthenticated: true,
      role: 'operations',
      pathname,
      permissions: ops,
      requiredRoles: TENANT_STAFF_ROLES,
    });
    assert.equal(decision.redirectTo, '/dashboard', pathname);
  }
});

test('vendor permissions do not include users or finance reconcile', () => {
  assert.equal(vendor.includes('users.manage'), false);
  assert.equal(vendor.includes('finance.reconcile'), false);
  assert.equal(vendor.includes('finance.view'), false);
});

test('merchant super admin can open /dashboard and /users-roles', () => {
  for (const pathname of ['/dashboard', '/users-roles']) {
    const decision = accessDecision({
      isAuthenticated: true,
      role: 'super_admin',
      pathname,
      permissions: ROLE_PERMISSIONS.super_admin,
      requiredRoles: TENANT_STAFF_ROLES,
    });
    assert.equal(decision.redirectTo, null);
  }
});

test('Dashboard Access is its own option, and staff without it land on Orders', () => {
  assert.equal(PERMISSION_CATALOG.some((item) => item.key === 'dashboard.view'), true);
  for (const role of TENANT_STAFF_ROLES) {
    assert.equal(ROLE_PERMISSIONS[role].includes('dashboard.view'), true, role);
  }
  assert.equal(ROLE_PERMISSIONS.vendor.includes('dashboard.view'), false);

  const ops = ROLE_PERMISSIONS.operations.filter((key) => key !== 'dashboard.view');
  assert.equal(homePathFor('operations', ROLE_PERMISSIONS.operations), '/dashboard');
  assert.equal(homePathFor('operations', ops), '/orders');
  const decision = accessDecision({
    isAuthenticated: true,
    role: 'operations',
    pathname: '/dashboard',
    permissions: ops,
    requiredRoles: TENANT_STAFF_ROLES,
  });
  assert.equal(decision.redirectTo, '/orders');
  const owner = ROLE_PERMISSIONS.super_admin.filter((key) => key !== 'dashboard.view');
  assert.equal(accessDecision({
    isAuthenticated: true,
    role: 'super_admin',
    pathname: '/settings',
    permissions: owner,
    requiredRoles: TENANT_STAFF_ROLES,
  }).redirectTo, null);
  assert.equal(homePathFor('super_admin', owner), '/orders');
  assert.equal(homePathFor('warehouse', ['inventory.view']), '/inventory');
  assert.equal(homePathFor('vendor', ROLE_PERMISSIONS.vendor), '/vendor/orders');
});

test('Order editing and Change mode of payment are their own Access options, owner only by default', () => {
  for (const key of ['orders.edit_details', 'orders.payment_mode']) {
    assert.equal(PERMISSION_CATALOG.some((item) => item.key === key), true, key);
    assert.equal(ROLE_PERMISSIONS.super_admin.includes(key), true, key);
    for (const role of [...TENANT_STAFF_ROLES.filter((code) => code !== 'super_admin'), 'vendor']) {
      assert.equal((ROLE_PERMISSIONS[role] || []).includes(key), false, `${role} ${key}`);
    }
  }
});

test('a list loaded for Leheriya is dropped after Back to platform', () => {
  const started = { generation: 1, tenantId: 'leheriya' };
  assert.equal(sameCompanySnapshot(started, { generation: 1, tenantId: 'leheriya' }), true);
  assert.equal(sameCompanySnapshot(started, { generation: 2, tenantId: 'platform' }), false);
  assert.equal(sameCompanySnapshot(started, { generation: 1, tenantId: 'platform' }), false);
});
