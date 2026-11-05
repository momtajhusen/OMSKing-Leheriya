import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./ProductsPage.jsx', import.meta.url), 'utf8');

test('product forms show Vendor (from Shopify) instead of Brand', () => {
  assert.doesNotMatch(page, />Brand</);
  assert.equal(page.match(/<label className="text-sm font-medium">Vendor<\/label>/g)?.length, 2);
  assert.match(page, /Search name, vendor, category or HSN/);
});
