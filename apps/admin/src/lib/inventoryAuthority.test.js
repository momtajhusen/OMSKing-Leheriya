import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../pages/admin/InventoryPage.jsx', import.meta.url), 'utf8');

test('Shopify-master sellable qty has no editor, and OMS-master qty can be adjusted', () => {
  assert.match(page, /const omsMaster = authority !== 'shopify'/);
  assert.match(page, /canInventoryAdjust && omsMaster &&/);
  assert.match(page, /\{item\.available\}/);
  assert.equal(page.includes('value={item.available}'), false);
  assert.equal(page.includes('value={item.stock}'), false);
});
