import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSteps, fixedPage, taskPage } from './taskPage.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const routes = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/orders', label: 'Orders' },
  { path: '/shipping', label: 'Shipping' },
  { path: '/inventory', label: 'Inventory' },
  { path: '/settings', label: 'Settings' },
];

test('the task area picks the page Auto-fix works on', () => {
  assert.equal(taskPage({ area: 'Orders list' }, routes), '/orders');
  assert.equal(taskPage({ area: 'Order detail → Shipment card' }, routes), '/orders', 'singular label still matches');
  assert.equal(taskPage({ area: 'Stock → Inventory' }, routes), '/inventory');
  assert.equal(taskPage({ area: 'Dashboard cards' }, routes), '/dashboard');
  assert.equal(taskPage({ area: '', message: 'Shipping tab me RTO chahiye' }, routes), '/shipping', 'falls back to the message');
  assert.equal(taskPage({ area: '', message: 'This page is not opening' }, routes), null, 'no guess when nothing matches');
  assert.equal(taskPage(null, routes), null);
});

test('Auto-fix opens that page when it starts and from the chat icon', () => {
  assert.match(read('../components/report/AutoFixButton.jsx'), /taskPage\(/);
  assert.match(read('../components/report/ChatPane.jsx'), /taskPage\(/);
});

test('when the area names no page, the fix text picks it (old completed tasks)', () => {
  const all = [...routes, { path: '/users-roles', label: 'Users & Roles' }];
  assert.equal(taskPage({ area: 'part of the Shree Maruti task above', fix: 'Settings Couriers me Shree Maruti joda', message: 'x' }, all), '/settings');
  assert.equal(taskPage({ area: 'Staff permissions', fix: 'Users & Roles me Dashboard access ka checkbox joda', message: 'x' }, all), '/users-roles');
  assert.equal(fixedPage({ status: 'done', area: '', fix: 'Order ke andar Map SKU button diya', title: 'Unmapped SKU' }, null, all), '/orders');
  assert.equal(fixedPage({ status: 'done', area: '', fix: '', title: 'x' }, { area: 'Staff permissions', fix: 'Users & Roles me joda' }, all), '/users-roles', 'local task list fix');
});

test('a fixed message links to the page of its issue; open or unknown ones do not', () => {
  assert.equal(fixedPage({ status: 'done', area: 'Orders list', title: 'x' }, null, routes), '/orders');
  assert.equal(fixedPage({ status: 'confirmed', area: '', title: 'Inventory stuck' }, { area: '' }, routes), '/inventory', 'falls back to the message');
  assert.equal(fixedPage({ status: 'done', area: '' , title: 'x' }, { area: 'Dashboard cards' }, routes), '/dashboard', 'local task list area');
  assert.equal(fixedPage({ status: 'in_progress', area: 'Orders list', title: 'x' }, null, routes), null);
  assert.equal(fixedPage({ status: 'done', area: '', title: 'This page is not opening' }, null, routes), null);
  assert.equal(fixedPage(null, null, routes), null);
  const bubble = read('../components/report/MessageBubble.jsx');
  assert.match(bubble, /fixedPage\(/);
  assert.match(bubble, /onOpenPage/);
});

test('the check steps of a fixed message become a short numbered list', () => {
  assert.deepEqual(checkSteps('Settings → Couriers kholo; Shree Maruti card dekho;  credentials save karo '), ['Settings → Couriers kholo', 'Shree Maruti card dekho', 'credentials save karo']);
  assert.deepEqual(checkSteps('Orders kholo\nORDER ID dekho'), ['Orders kholo', 'ORDER ID dekho']);
  assert.deepEqual(checkSteps(''), []);
  assert.deepEqual(checkSteps(undefined), []);
  const bubble = read('../components/report/MessageBubble.jsx');
  assert.match(bubble, /checkSteps\(/);
  assert.match(bubble, /Kaise check karein/);
});
