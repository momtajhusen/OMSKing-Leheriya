import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterReportOrders } from './reportFilters.js';

const reports = fs.readFileSync(new URL('../pages/admin/ReportsPage.jsx', import.meta.url), 'utf8');

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const orders = [
  { id: 'A', channel: 'Shopify', createdAt: at(2026, 9, 30, 23) },
  { id: 'B', channel: 'Amazon', createdAt: at(2026, 10, 1, 0) },
  { id: 'C', channel: 'Shopify', createdAt: at(2026, 10, 15) },
  { id: 'D', channel: 'Myntra', createdAt: at(2026, 10, 31, 23) },
  { id: 'E', channel: 'Shopify', createdAt: at(2026, 11, 1, 0) },
];
const ids = (rows) => rows.map((row) => row.id);

test('no filters keeps every order', () => {
  assert.deepEqual(ids(filterReportOrders(orders)), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(ids(filterReportOrders(orders, { channel: '', from: '', to: '' })), ['A', 'B', 'C', 'D', 'E']);
});

test('channel filter keeps only that channel', () => {
  assert.deepEqual(ids(filterReportOrders(orders, { channel: 'Shopify' })), ['A', 'C', 'E']);
});

test('from and to are inclusive local calendar days', () => {
  assert.deepEqual(ids(filterReportOrders(orders, { from: '2026-10-01', to: '2026-10-31' })), ['B', 'C', 'D']);
  assert.deepEqual(ids(filterReportOrders(orders, { from: '2026-10-15' })), ['C', 'D', 'E']);
  assert.deepEqual(ids(filterReportOrders(orders, { to: '2026-10-01' })), ['A', 'B']);
});

test('channel and period combine', () => {
  assert.deepEqual(ids(filterReportOrders(orders, { channel: 'Shopify', from: '2026-10-01', to: '2026-10-31' })), ['C']);
});

test('orders without a valid date drop out only when a period is chosen', () => {
  const rows = [...orders, { id: 'X', channel: 'Shopify', createdAt: '' }];
  assert.ok(ids(filterReportOrders(rows, { channel: 'Shopify' })).includes('X'));
  assert.ok(!ids(filterReportOrders(rows, { from: '2026-10-01' })).includes('X'));
});

test('Reports page has Channel and From/To filters that drive the order reports', () => {
  assert.match(reports, /filterReportOrders\(orders, \{ channel: channelFilter, from: fromDate, to: toDate \}\)/);
  assert.match(reports, /All channels/);
  assert.match(reports, /type="date"[^>]*value=\{fromDate\}/);
  assert.match(reports, /type="date"[^>]*value=\{toDate\}/);
  assert.match(reports, /salesByChannel\(filtered,/);
  assert.match(reports, /netSales\(filtered\)/);
});
