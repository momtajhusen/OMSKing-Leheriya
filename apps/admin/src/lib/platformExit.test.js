import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

await register(new URL('./extensionless-loader.mjs', import.meta.url));

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
};

test('back to platform clears merchant packing data from client state', async () => {
  const { default: useAuthStore } = await import('../stores/authStore.js');
  const { default: useOrderStore } = await import('../stores/orderStore.js');
  const { default: useReturnsStore } = await import('../stores/returnsStore.js');
  const { default: useVendorStore } = await import('../stores/vendorStore.js');
  const { default: useChannelStore } = await import('../stores/channelStore.js');
  const { default: useProductImageStore } = await import('./productImageStore.js');

  useAuthStore.getState().persist('merchant-token', {
    id: 'platform-user',
    email: 'platform@omsking.com',
    name: 'Platform',
    role: 'super_admin',
    permissions: ['orders.view'],
    tenantId: 'merchant-leheriya',
    tenantName: 'Leheriya Silks',
    impersonating: true,
  });
  useOrderStore.setState({
    orders: [{ id: 'LEH-PACK-14', customer: 'Hidden Leheriya Buyer', phone: '9811100141' }],
    loaded: true,
  });
  useReturnsStore.setState({
    returns: [{ id: 'RET-LEH', orderNo: 'LEH-PACK-14' }],
    workflowByTenant: { 'merchant-leheriya': { 'RET-LEH': { status: 'Approved' } } },
  });
  useVendorStore.setState({
    vendors: [{ id: 'vendor-1', name: 'Raj Prints', removed: false }],
    autoAssignByTenant: { 'merchant-leheriya': true },
  });
  useChannelStore.setState({
    enabledIds: ['shopify'],
    connections: { shopify: { credentials: { adminToken: 'shpat_should_clear' } } },
  });
  useProductImageStore.setState({ byKey: { 'leh-sku': 'https://cdn.shopify.com/s/files/bandh.jpg' } });

  useAuthStore.getState().persist('platform-token', {
    id: 'platform-user',
    email: 'platform@omsking.com',
    name: 'Platform',
    role: 'platform_admin',
    permissions: ['tenants.manage'],
    tenantId: 'platform-home',
    tenantName: 'OMSKing SaaS',
    impersonating: false,
  });

  assert.deepEqual(useOrderStore.getState().orders, []);
  assert.deepEqual(useReturnsStore.getState().returns, []);
  assert.deepEqual(useReturnsStore.getState().workflowByTenant, {});
  assert.deepEqual(useVendorStore.getState().vendors, []);
  assert.deepEqual(useVendorStore.getState().autoAssignByTenant, {});
  assert.deepEqual(useChannelStore.getState().connections, {});
  assert.deepEqual(useProductImageStore.getState().byKey, {});
  const saved = JSON.parse(localStorage.getItem('user'));
  assert.equal(saved.impersonating, false);
  assert.equal(saved.tenantId, 'platform-home');
  assert.equal(localStorage.getItem('token'), 'platform-token');
  const dumped = JSON.stringify([...memory.values()]);
  assert.equal(dumped.includes('LEH-PACK-14'), false);
  assert.equal(dumped.includes('Hidden Leheriya Buyer'), false);
  assert.equal(dumped.includes('Raj Prints'), false);
  assert.equal(dumped.includes('shpat_should_clear'), false);
  assert.equal(dumped.includes('merchant-leheriya'), false);
});
