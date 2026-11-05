import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterReturnRows } from './reportFilters.js';

const page = fs.readFileSync(new URL('../pages/admin/ReturnsRefundsReconciliationPage.jsx', import.meta.url), 'utf8');

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const row = (id, channel, kind, paymentMode, createdAt) => ({ key: id, kind, order: { id, channel, paymentMode, createdAt } });
const rows = [
  row('A', 'Shopify', 'Cancelled before dispatch', 'COD', at(2026, 9, 30, 23)),
  row('B', 'Amazon', 'Cancelled after dispatch (RTO)', 'Prepaid', at(2026, 10, 1, 0)),
  row('C', 'Shopify', 'Customer return', 'Prepaid', at(2026, 10, 15)),
  row('D', 'Myntra', 'Cancelled before dispatch', 'Void', at(2026, 10, 31, 23)),
  row('E', 'Shopify', 'Cancelled before dispatch', 'Prepaid', at(2026, 11, 1, 0)),
];
const ids = (list) => list.map((item) => item.key);

test('no filters keeps every return row', () => {
  assert.deepEqual(ids(filterReturnRows(rows)), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(ids(filterReturnRows(rows, { channel: '', kind: '', payment: '', from: '', to: '' })), ['A', 'B', 'C', 'D', 'E']);
});

test('filters return rows by channel, type and payment', () => {
  assert.deepEqual(ids(filterReturnRows(rows, { channel: 'Shopify' })), ['A', 'C', 'E']);
  assert.deepEqual(ids(filterReturnRows(rows, { kind: 'Cancelled before dispatch' })), ['A', 'D', 'E']);
  assert.deepEqual(ids(filterReturnRows(rows, { payment: 'Prepaid' })), ['B', 'C', 'E']);
  assert.deepEqual(ids(filterReturnRows(rows, { channel: 'Shopify', kind: 'Cancelled before dispatch', payment: 'Prepaid' })), ['E']);
});

test('filters return rows by inclusive order-date period', () => {
  assert.deepEqual(ids(filterReturnRows(rows, { from: '2026-10-01', to: '2026-10-31' })), ['B', 'C', 'D']);
  assert.deepEqual(ids(filterReturnRows(rows, { channel: 'Shopify', from: '2026-10-01' })), ['C', 'E']);
});

test('Returns & Refunds page has Channel, Type, Payment and date filters that drive cards and records', () => {
  assert.match(page, /filterReturnRows\(rows,/);
  assert.match(page, />All channels</);
  assert.match(page, />All types</);
  assert.match(page, />All payments</);
  assert.match(page, /type="date"/);
  assert.match(page, /Clear filters/);
  assert.doesNotMatch(page, /value=\{rows\.length\}/);
  assert.doesNotMatch(page, /const list = rows\.filter/);
});
