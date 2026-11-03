import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./OrdersPage.jsx', import.meta.url), 'utf8');

test('the order list shows the original channel order id with the OMS id under it', () => {
  assert.match(page, /order\.channelOrderNo \|\| order\.id/);
  assert.match(page, /order\.channelOrderNo && order\.channelOrderNo !== order\.id/);
});

test('orders have Shipway-style Pickup & Manifest, In Transit, Delivered and RTO tabs with counts', () => {
  const tabs = page.slice(page.indexOf('const STATUS_TABS'), page.indexOf('];', page.indexOf('const STATUS_TABS')));
  const order = ['Ready to Ship', 'Pickup & Manifest', 'In Transit', 'Delivered', 'RTO', 'Cancelled', 'all']
    .map((id) => tabs.indexOf(`id: '${id}'`));
  order.forEach((index) => assert.ok(index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(page, /counts\[tab\.id\]/);
});
