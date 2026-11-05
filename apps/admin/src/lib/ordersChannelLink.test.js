import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordersChannelPath, channelFromSearch } from './ordersChannelLink.js';

const dashboard = fs.readFileSync(new URL('../pages/admin/DashboardPage.jsx', import.meta.url), 'utf8');
const orders = fs.readFileSync(new URL('../pages/admin/OrdersPage.jsx', import.meta.url), 'utf8');

test('a channel card links to the Orders page with that channel tab selected', () => {
  assert.equal(ordersChannelPath('Shopify'), '/orders?channel=Shopify');
  assert.equal(ordersChannelPath('Amazon'), '/orders?channel=Amazon');
  assert.equal(ordersChannelPath('Myntra PPMP'), '/orders?channel=Myntra+PPMP');
  assert.equal(ordersChannelPath(''), '/orders');
  assert.equal(ordersChannelPath('all'), '/orders');
});

test('the Orders page reads the channel tab from the link, defaulting to all channels', () => {
  assert.equal(channelFromSearch(new URLSearchParams('channel=Myntra')), 'Myntra');
  assert.equal(channelFromSearch(new URLSearchParams('channel=Myntra+PPMP')), 'Myntra PPMP');
  assert.equal(channelFromSearch(new URLSearchParams('channel=%20')), 'all');
  assert.equal(channelFromSearch(new URLSearchParams('')), 'all');
});

test('dashboard channel cards open their channel tab, not All channels', () => {
  assert.match(dashboard, /onClick=\{\(\) => navigate\(ordersChannelPath\(row\.channel\)\)\}/);
  assert.match(orders, /useState\(\(\) => channelFromSearch\(searchParams\)\)/);
});
