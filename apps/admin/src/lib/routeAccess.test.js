import test from 'node:test';
import assert from 'node:assert/strict';
import { TENANT_STAFF_ROLES } from '../constants/roles.js';
import { ROLE_PERMISSIONS } from '../constants/permissions.js';
import { accessDecision } from './routeAccess.js';
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

test('a list loaded for Leheriya is dropped after Back to platform', () => {
  const started = { generation: 1, tenantId: 'leheriya' };
  assert.equal(sameCompanySnapshot(started, { generation: 1, tenantId: 'leheriya' }), true);
  assert.equal(sameCompanySnapshot(started, { generation: 2, tenantId: 'platform' }), false);
  assert.equal(sameCompanySnapshot(started, { generation: 1, tenantId: 'platform' }), false);
});
