import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { menuPosition, statusOptions, statusParam, selectedStatuses } from './statusFilter.js';

const TABS = [
  { id: 'New', label: 'New' },
  { id: 'Packed', label: 'Packed' },
  { id: 'Ready to Ship', label: 'Ready To Ship' },
  { id: 'In Transit', label: 'In Transit' },
  { id: 'all', label: 'All Orders' },
];

test('status filter search matches labels case-insensitively and leaves out All Orders', () => {
  assert.deepEqual(statusOptions(TABS, '').map((tab) => tab.id), ['New', 'Packed', 'Ready to Ship', 'In Transit']);
  assert.deepEqual(statusOptions(TABS, ' ship ').map((tab) => tab.id), ['Ready to Ship']);
  assert.deepEqual(statusOptions(TABS, 'IN').map((tab) => tab.id), ['In Transit']);
  assert.deepEqual(statusOptions(TABS, 'xyz'), []);
});

test('ticked statuses become one comma separated status param; none or every one means all', () => {
  assert.equal(statusParam([], TABS), 'all');
  assert.equal(statusParam(['Packed', 'New'], TABS), 'New,Packed');
  assert.equal(statusParam(['New', 'Packed', 'Ready to Ship', 'In Transit'], TABS), 'all');
  assert.equal(statusParam(['New', 'Bogus'], TABS), 'New');
});

test('the current status param opens the filter with those boxes ticked', () => {
  assert.deepEqual(selectedStatuses('all', TABS), []);
  assert.deepEqual(selectedStatuses('', TABS), []);
  assert.deepEqual(selectedStatuses('Packed', TABS), ['Packed']);
  assert.deepEqual(selectedStatuses('In Transit,New', TABS), ['New', 'In Transit']);
});

test('the status menu opens right under its icon and stays inside the screen', () => {
  assert.deepEqual(menuPosition({ left: 300, right: 316, bottom: 200 }, 1280), { top: 206, left: 300 });
  assert.deepEqual(menuPosition({ left: 1200, right: 1216, bottom: 200 }, 1280), { top: 206, left: 1280 - 288 - 8 }, 'near the right edge it ends at the screen edge');
  assert.deepEqual(menuPosition({ left: 2, right: 18, bottom: 50 }, 1280), { top: 56, left: 8 });
});

test('the status menu is rendered on the page body, so a transformed parent cannot move it away from the icon', () => {
  const page = fs.readFileSync(new URL('../pages/admin/OrdersPage.jsx', import.meta.url), 'utf8');
  const filter = page.slice(page.indexOf('function StatusColumnFilter'), page.indexOf('export default function OrdersPage'));
  assert.match(filter, /createPortal\(/);
  assert.match(filter, /menuPosition\(/);
  assert.match(filter, /menuRef\.current\?\.contains/);
});
