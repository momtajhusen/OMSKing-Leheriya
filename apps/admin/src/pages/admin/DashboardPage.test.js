import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('./DashboardPage.jsx', import.meta.url), 'utf8');
const kpis = page.slice(page.indexOf('kpi-grid'), page.indexOf('orderCount === 0'));

test('dashboard KPI cards are only the client list: new orders and sales per channel, return issues, problem invoices', () => {
  assert.match(kpis, /label="New Orders"/);
  assert.match(kpis, /row\.newOrders/);
  assert.match(kpis, /label="Net Sales"/);
  assert.match(kpis, /row\.revenue/);
  assert.match(kpis, /label="Return issues"/);
  assert.match(kpis, /label="Problem invoices"/);
  assert.doesNotMatch(kpis, /Awaiting dispatch/);
  assert.doesNotMatch(kpis, /Low Stock/);
  assert.equal((kpis.match(/<KpiCard/g) || []).length, 6);
});

test('order status is a donut with a readable list, so small slices never print labels on top of each other', () => {
  const card = page.slice(page.indexOf('<CardTitle>Order Status</CardTitle>'), page.indexOf('Sales by Channel'));
  const pie = card.slice(card.indexOf('<Pie'), card.indexOf('</Pie>'));
  assert.doesNotMatch(pie, /\slabel=/, 'no text drawn next to each slice');
  assert.match(pie, /innerRadius=/);
  assert.match(card, /data-status-legend/);
  assert.match(card, /stats\.statuses\.map\(\(entry, index\) => \(\s*<li/);
  assert.match(card, /statusShare\(entry\.count, orderCount\)/);
  assert.match(card, /\{entry\.count\}/);
  const colors = page.match(/const COLORS = \[([^\]]*)\]/)[1].split(',').map((value) => value.trim()).filter(Boolean);
  assert.ok(colors.length >= 9, 'every order status gets its own colour');
  assert.equal(new Set(colors).size, colors.length);
});

test('status share shows a whole percent, and under 1% instead of 0%', async () => {
  const { statusShare } = await import('../../lib/orderMetrics.js');
  assert.equal(statusShare(58, 100), '58%');
  assert.equal(statusShare(1, 300), '<1%');
  assert.equal(statusShare(0, 300), '0%');
  assert.equal(statusShare(3, 0), '0%');
});
