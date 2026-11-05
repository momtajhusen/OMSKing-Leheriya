import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./FulfilmentPage.jsx');
const store = read('../../stores/orderStore.js');

test('Assignment vendor line has a purchase Cost field read from Shopify', () => {
  assert.match(page, /placeholder="Cost"/);
  assert.match(page, /readLineCost\(line\.masterOrderId, line\.vendorOrderId\)/);
  assert.match(store, /api\.get\(\s*`\/orders\/\$\{encodeURIComponent\(masterId\)\}\/sub-orders\/\$\{encodeURIComponent\(subOrderId\)\}\/cost`/);
});

test('blank Shopify cost can be filled and saved back to Shopify', () => {
  assert.match(page, /saveLineCost\(line\.masterOrderId, line\.vendorOrderId, costValue\)/);
  assert.match(page, /disabled=\{!cost\.editable/);
  assert.match(store, /api\.put\(\s*`\/orders\/\$\{encodeURIComponent\(masterId\)\}\/sub-orders\/\$\{encodeURIComponent\(subOrderId\)\}\/cost`,\s*\{ cost \}/);
});
