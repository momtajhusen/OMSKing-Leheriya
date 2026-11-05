import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleId, togglePage, packableIds, labelableIds } from './bulkOrderActions.js';

const orders = [
  { id: 'SHP-1', channel: 'Shopify', status: 'New' },
  { id: 'SHP-2', channel: 'Shopify', status: 'Packed' },
  { id: 'SHP-3', channel: 'Shopify', status: 'New', awb: '123' },
  { id: 'SHP-4', channel: 'Shopify', status: 'New', mappingFailed: true },
  { id: 'MYN-1', channel: 'Myntra PPMP', status: 'New' },
  { id: 'AMZ-1', channel: 'Amazon', status: 'Packed' },
  { id: 'SHP-5', channel: 'Shopify', status: 'Delivered' },
];
const all = orders.map((order) => order.id);

test('a row checkbox adds or removes that order from the selection', () => {
  assert.deepEqual(toggleId([], 'SHP-1'), ['SHP-1']);
  assert.deepEqual(toggleId(['SHP-1', 'SHP-2'], 'SHP-1'), ['SHP-2']);
});

test('the header checkbox selects every order on the page, or clears them when all are ticked', () => {
  assert.deepEqual(togglePage(['X'], ['SHP-1', 'SHP-2']), ['X', 'SHP-1', 'SHP-2']);
  assert.deepEqual(togglePage(['X', 'SHP-1', 'SHP-2'], ['SHP-1', 'SHP-2']), ['X']);
  assert.deepEqual(togglePage(['SHP-1'], ['SHP-1', 'SHP-2']), ['SHP-1', 'SHP-2']);
});

test('Pack selected only packs ticked New orders whose SKUs are mapped', () => {
  assert.deepEqual(packableIds(orders, all), ['SHP-1', 'SHP-3', 'MYN-1']);
  assert.deepEqual(packableIds(orders, ['SHP-2', 'SHP-1']), ['SHP-1']);
});

test('Generate labels only books ticked own-courier orders that have no AWB yet', () => {
  assert.deepEqual(labelableIds(orders, all), ['SHP-1', 'SHP-2']);
  assert.deepEqual(labelableIds(orders, ['MYN-1', 'AMZ-1', 'SHP-3']), []);
});
