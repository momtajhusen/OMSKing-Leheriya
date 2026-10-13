import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_PERMISSIONS } from '../../constants/permissions.js';
import { TENANT_STAFF_ROLES } from '../../constants/roles.js';
import { accessDecision } from '../../lib/routeAccess.js';

const sidebar = fs.readFileSync(new URL('../../components/layout/AdminSidebar.jsx', import.meta.url), 'utf8');
const platform = fs.readFileSync(new URL('../../components/layout/PlatformLayout.jsx', import.meta.url), 'utf8');
const guide = fs.readFileSync(new URL('../../components/setup/SetupGuide.jsx', import.meta.url), 'utf8');
const merchant = fs.readFileSync(new URL('./SetupGuidePage.jsx', import.meta.url), 'utf8');
const platformPage = fs.readFileSync(new URL('../platform/PlatformSetupPage.jsx', import.meta.url), 'utf8');

test('merchant and platform sidebars pin a setup guide at the bottom', () => {
  assert.match(sidebar, /to="\/setup"/);
  assert.match(sidebar, /Setup guide/);
  assert.match(platform, /to="\/platform\/setup"/);
  assert.match(platform, /Setup guide/);
  assert.match(merchant, /\/setup\/checklist/);
  assert.match(platformPage, /\/tenants\/setup-checklist/);
});

test('a tick is rendered only when the checklist marks the step done', () => {
  assert.match(guide, /Where to click/);
  assert.match(guide, /Where to get the details/);
  assert.match(guide, /active\.clicks/);
  assert.match(guide, /active\.sources/);
  assert.match(guide, /role="tablist"/);
  assert.match(guide, /aria-orientation="vertical"/);
  assert.match(guide, /item\.done \? <Check/);
  assert.match(guide, /aria-label=\{item\.done \? 'Complete' : 'Not complete'\}/);
  assert.doesNotMatch(guide, /defaultChecked/);
});

test('operations cannot open the merchant setup guide', () => {
  const denied = accessDecision({
    isAuthenticated: true,
    role: 'operations',
    pathname: '/setup',
    permissions: ROLE_PERMISSIONS.operations,
    requiredRoles: TENANT_STAFF_ROLES,
  });
  assert.equal(denied.redirectTo, '/dashboard');
  const allowed = accessDecision({
    isAuthenticated: true,
    role: 'super_admin',
    pathname: '/setup',
    permissions: ROLE_PERMISSIONS.super_admin,
    requiredRoles: TENANT_STAFF_ROLES,
  });
  assert.equal(allowed.redirectTo, null);
});
