import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('./DashboardPage.jsx', import.meta.url), 'utf8');
const kpis = page.slice(page.indexOf('kpi-grid'), page.indexOf('orderCount === 0'));

test('dashboard KPI cards are only the client list: new orders and sales per channel, return issues, problem invoices', () => {
  assert.match(kpis, /label="New Orders"/);
  assert.match(kpis, /row\.newOrders/);
  assert.match(kpis, /label="Total Sales"/);
  assert.match(kpis, /row\.revenue/);
  assert.match(kpis, /label="Return issues"/);
  assert.match(kpis, /label="Problem invoices"/);
  assert.doesNotMatch(kpis, /Awaiting dispatch/);
  assert.doesNotMatch(kpis, /Low Stock/);
  assert.equal((kpis.match(/<KpiCard/g) || []).length, 6);
});
