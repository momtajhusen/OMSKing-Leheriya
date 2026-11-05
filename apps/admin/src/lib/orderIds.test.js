import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { shortOrderId, shortSubOrderId } from './orderIds.js';

const detail = fs.readFileSync(new URL('../pages/admin/OrderDetailPage.jsx', import.meta.url), 'utf8');

test('orders show the channel order number, and sub-orders add the unit index to it', () => {
  const shopify = { id: 'SHP-19028924072029', channelOrderNo: '#68762-LEH' };
  assert.equal(shortOrderId(shopify), '68762-LEH');
  assert.equal(shortSubOrderId(shopify, { id: 'SHP-19028924072029-2', index: 2 }), '68762-LEH-2');

  const manual = { id: 'MAN-1001', channelOrderNo: '' };
  assert.equal(shortOrderId(manual), 'MAN-1001');
  assert.equal(shortSubOrderId(manual, { id: 'MAN-1001-1', index: 1 }), 'MAN-1001-1');
});

test('the order page shows short ids and the Shopify vendor next to the photo', () => {
  assert.match(detail, /shortOrderId\(order\)/);
  assert.match(detail, /shortSubOrderId\(order, sub\)/);
  assert.match(detail, /item\.vendor/);
});
