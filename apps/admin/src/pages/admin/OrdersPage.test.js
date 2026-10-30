import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./OrdersPage.jsx', import.meta.url), 'utf8');

test('the order list shows the original channel order id with the OMS id under it', () => {
  assert.match(page, /order\.channelOrderNo \|\| order\.id/);
  assert.match(page, /order\.channelOrderNo && order\.channelOrderNo !== order\.id/);
});
