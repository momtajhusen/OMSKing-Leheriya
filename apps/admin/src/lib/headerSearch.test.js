import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordersSearchPath, searchFromParams } from './headerSearch.js';

const header = fs.readFileSync(new URL('../components/layout/AdminHeader.jsx', import.meta.url), 'utf8');
const orders = fs.readFileSync(new URL('../pages/admin/OrdersPage.jsx', import.meta.url), 'utf8');

test('header search for an order id opens the Orders page with that search', () => {
  assert.equal(ordersSearchPath('SHP-19034433421405'), '/orders?q=SHP-19034433421405');
  assert.equal(ordersSearchPath('  Sunil Khot '), '/orders?q=Sunil+Khot');
  assert.equal(ordersSearchPath('   '), null);
  assert.equal(ordersSearchPath(''), null);
});

test('the Orders page reads the search from the link', () => {
  assert.equal(searchFromParams(new URLSearchParams('q=SHP-19034433421405')), 'SHP-19034433421405');
  assert.equal(searchFromParams(new URLSearchParams('q=Sunil+Khot')), 'Sunil Khot');
  assert.equal(searchFromParams(new URLSearchParams('q=%20')), '');
  assert.equal(searchFromParams(new URLSearchParams('')), '');
});

test('header search submits to the Orders page and the Orders page fills its search box from the link', () => {
  assert.match(header, /onSubmit=\{submitSearch\}/);
  assert.match(header, /const path = ordersSearchPath\(searchText\);\s+if \(path && canOpenPath\('\/orders'\)\) navigate\(path\);/);
  assert.match(orders, /useState\(\(\) => searchFromParams\(searchParams\)\)/);
  assert.match(orders, /setSearchQuery\(urlQuery\)/);
});
