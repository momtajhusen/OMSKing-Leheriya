import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./InventoryPage.jsx', import.meta.url), 'utf8');

test('the inventory page can queue the one-time Shopify opening stock import for settings managers', () => {
  assert.match(page, /api\.post\('\/integrations\/jobs', \{ channel: 'shopify', jobType: 'stock_import' \}\)/);
  assert.match(page, /can\(PERMISSIONS\.SETTINGS_MANAGE\) && omsMaster/);
  assert.match(page, /Import stock from Shopify/);
});
