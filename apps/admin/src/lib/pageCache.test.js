import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedPage, pageSession, rememberPage } from './pageCache.js';

const storage = (user) => ({ getItem: (k) => (k === 'user' ? JSON.stringify(user) : null) });

test('a page remembers its last default view per user and company, so reopening it shows that at once', () => {
  const a = pageSession(storage({ id: 'u1', tenantId: 't1' }));
  const b = pageSession(storage({ id: 'u1', tenantId: 't2' }));
  assert.equal(cachedPage('products', a), null);
  rememberPage('products', { rows: [1] }, a);
  assert.deepEqual(cachedPage('products', a), { rows: [1] });
  assert.equal(cachedPage('products', b), null, 'another company never sees it');
  assert.equal(cachedPage('inventory', a), null);
  assert.equal(pageSession({ getItem: () => 'not json' }), '|');
});

test('Products and Inventory open from the remembered view and refresh it in the background', () => {
  const products = fs.readFileSync(new URL('../pages/admin/ProductsPage.jsx', import.meta.url), 'utf8');
  assert.match(products, /const seed = cachedPage\('products'\);/);
  assert.match(products, /useState\(seed\?\.rows \|\| \[\]\)/);
  assert.match(products, /if \(page === 1 && !searchQuery\) rememberPage\('products'/);
  const inventory = fs.readFileSync(new URL('../pages/admin/InventoryPage.jsx', import.meta.url), 'utf8');
  assert.match(inventory, /const seed = cachedPage\('inventory'\);/);
  assert.match(inventory, /useState\(seed\?\.rows \|\| \[\]\)/);
  assert.match(inventory, /useState\(cachedPage\('warehouses'\) \|\| \[\]\)/);
  assert.match(inventory, /rememberPage\('warehouses'/);
  assert.match(inventory, /if \(!warehouseId && tab === 'all' && !q && !sort && page === 1\) rememberPage\('inventory'/);
});
