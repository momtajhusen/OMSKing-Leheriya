import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const vite = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

const { ROLES, homePathForRole, MERCHANT_ROLES } = await vite.ssrLoadModule('/src/constants/roles.js');
const { findDemoAccount, DEMO_PASSWORD } = await vite.ssrLoadModule('/src/mocks/platform.js');
const useAuthStore = (await vite.ssrLoadModule('/src/stores/authStore.js')).default;

const fail = [];
const ok = (name, cond, detail) => {
  if (cond) console.log('ok    ', name);
  else {
    fail.push(`${name}: ${detail || 'failed'}`);
    console.log('FAIL  ', name, detail || '');
  }
};

ok('platform home', homePathForRole(ROLES.PLATFORM_ADMIN) === '/platform');
ok('merchant home', homePathForRole(ROLES.SUPER_ADMIN) === '/dashboard');
ok('ops is merchant role', MERCHANT_ROLES.includes(ROLES.ADMIN));
ok('vendor home', homePathForRole(ROLES.VENDOR) === '/vendor/orders');

const platform = findDemoAccount('platform@omsking.com', DEMO_PASSWORD);
const merchant = findDemoAccount('superadmin@omsking.com', DEMO_PASSWORD);
const ops = findDemoAccount('ops@leheriya.com', DEMO_PASSWORD);
const vendor = findDemoAccount('vendor@omsking.com', DEMO_PASSWORD);

ok('demo platform', platform?.role === ROLES.PLATFORM_ADMIN && !platform.tenantId);
ok('demo merchant', merchant?.role === ROLES.SUPER_ADMIN && merchant.tenantId === 'TNT-001');
ok('demo ops', ops?.role === ROLES.ADMIN);
ok('demo vendor', vendor?.role === ROLES.VENDOR && vendor.vendorId === 'VND-001');
ok('unknown rejected', !findDemoAccount('nope@x.com', DEMO_PASSWORD));

useAuthStore.getState().login('t-platform', {
  email: platform.email,
  name: platform.name,
  role: platform.role,
  tenantId: platform.tenantId,
  tenantName: platform.tenantName,
});
ok('login platform', useAuthStore.getState().user.role === ROLES.PLATFORM_ADMIN);

useAuthStore.getState().impersonateTenant({ id: 'TNT-001', name: 'Leheriya Creations' });
const impersonated = useAuthStore.getState().user;
ok('impersonate role', impersonated.role === ROLES.SUPER_ADMIN);
ok('impersonate flag', impersonated.impersonating === true);
ok('impersonate tenant', impersonated.tenantName === 'Leheriya Creations');
ok('keeps platform email', impersonated.email === platform.email);

useAuthStore.getState().exitImpersonation();
ok('exit role', useAuthStore.getState().user.role === ROLES.PLATFORM_ADMIN);
ok('exit no flag', !useAuthStore.getState().user.impersonating);

useAuthStore.getState().login('t-sa', {
  email: merchant.email,
  name: merchant.name,
  role: merchant.role,
  tenantId: merchant.tenantId,
  tenantName: merchant.tenantName,
});
ok('merchant cannot impersonate', (() => {
  useAuthStore.getState().impersonateTenant({ id: 'TNT-002', name: 'Jaipur Craft Co.' });
  return useAuthStore.getState().user.tenantId === 'TNT-001';
})());

await vite.close();
if (fail.length) {
  console.log(`\n${fail.length} failed`);
  process.exit(1);
}
console.log('\nAll auth/RBAC store checks passed');
