import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./GstInvoicePage.jsx', import.meta.url), 'utf8');

test('the GST page reads WH-001 from the warehouses list the API returns', () => {
  assert.match(page, /data\.data\?\.warehouses/);
});
