import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { periodParams, periodLabel } from './dashboardPeriod.js';

const dashboard = fs.readFileSync(new URL('../pages/admin/DashboardPage.jsx', import.meta.url), 'utf8');

test('preset periods send days, a custom period sends the chosen from and to dates', () => {
  assert.deepEqual(periodParams('all'), { days: 'all' });
  assert.deepEqual(periodParams('7'), { days: '7' });
  assert.deepEqual(periodParams('custom', '2026-10-02', '2026-10-10'), { from: '2026-10-02', to: '2026-10-10' });
  assert.deepEqual(periodParams('custom', '2026-10-02', ''), { from: '2026-10-02' });
  assert.deepEqual(periodParams('custom', '', ''), { days: 'all' });
});

test('the trend title names the chosen period', () => {
  assert.equal(periodLabel('all'), 'Last 14 Days');
  assert.equal(periodLabel('30'), 'Last 30 Days');
  assert.equal(periodLabel('custom', '2026-10-02', '2026-10-10'), '2026-10-02 to 2026-10-10');
  assert.equal(periodLabel('custom', '2026-10-02', ''), 'From 2026-10-02');
  assert.equal(periodLabel('custom', '', '2026-10-10'), 'Up to 2026-10-10');
  assert.equal(periodLabel('custom', '', ''), 'Last 14 Days');
});

test('today sends the local calendar date as both from and to', () => {
  const now = new Date(2026, 10, 4, 23, 30);
  assert.deepEqual(periodParams('today', '', '', now), { from: '2026-11-04', to: '2026-11-04' });
  assert.deepEqual(periodParams('today', '2026-10-02', '2026-10-10', new Date(2026, 0, 9, 0, 5)), { from: '2026-01-09', to: '2026-01-09' });
  assert.equal(periodLabel('today'), 'Today');
});

test('the dashboard period filter offers today next to the presets', () => {
  assert.match(dashboard, /<option value="all">All time<\/option>\s*<option value="today">Today<\/option>/);
});

test('the dashboard period filter offers a custom date range', () => {
  assert.match(dashboard, /<option value="custom">Custom range<\/option>/);
  assert.match(dashboard, /<Input type="date".*aria-label="From date" \/>/);
  assert.match(dashboard, /<Input type="date".*aria-label="To date" \/>/);
  assert.match(dashboard, /\.\.\.periodParams\(range, fromDate, toDate\)/);
});
