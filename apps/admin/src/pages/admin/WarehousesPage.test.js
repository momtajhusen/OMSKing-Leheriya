import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('./WarehousesPage.jsx', import.meta.url), 'utf8');

test('WH-001 pickup can be saved from the warehouse page', () => {
  assert.match(page, /contactPhone/);
  assert.match(page, /pincode/);
  assert.match(page, /line1/);
  assert.match(page, /\/warehouses\//);
});
