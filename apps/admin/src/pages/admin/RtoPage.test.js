import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./RtoPage.jsx', import.meta.url), 'utf8');

test('RTO Order ID column shows channel order id', () => {
  assert.match(page, /shortOrderId\(row\.order\)/);
});

test('RTO table fits the page: fixed layout and stacked columns without side scroll wrapper', () => {
  const table = page.slice(page.indexOf('RTO Shipments'), page.indexOf('RTO Flow'));
  assert.match(table, /table-fixed/);
  assert.match(table, /Order · Channel/);
  assert.match(table, /AWB · Reason/);
  assert.match(table, /Status · QC/);
  assert.doesNotMatch(table, /overflow-x-auto/);
  assert.equal((table.match(/<TableHead[\s>]/g) || []).length, 6);
});
