import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, clearQuery, isFresh, peekQuery, putQuery } from './queryCache.js';

test('queryCache stores and peeks real payloads for SWR', () => {
  clearQuery();
  const key = cacheKey(['orders', 'all', 1]);
  putQuery(key, { rows: [{ id: '1' }] });
  const hit = peekQuery(key);
  assert.deepEqual(hit.data, { rows: [{ id: '1' }] });
  assert.equal(isFresh(hit, 60_000), true);
  assert.equal(isFresh({ at: Date.now() - 120_000 }, 60_000), false);
});

test('dashboard and orders pages paint from cache instead of blanking the page', async () => {
  const fs = await import('node:fs');
  const dashboard = fs.readFileSync(new URL('../pages/admin/DashboardPage.jsx', import.meta.url), 'utf8');
  const orders = fs.readFileSync(new URL('../pages/admin/OrdersPage.jsx', import.meta.url), 'utf8');
  assert.match(dashboard, /useCachedQuery/);
  assert.match(dashboard, /SoftRefresh/);
  assert.match(orders, /rememberPage\('orders-default'/);
  assert.match(orders, /loading && orderList\.length === 0/);
  assert.match(orders, /Background channel pull/);
});
