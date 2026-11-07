import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelIssuesInvoice } from './channelInvoice.js';

test('Amazon and Myntra API orders get their tax invoice from the channel; Shopify and manual orders from OMS', () => {
  assert.equal(channelIssuesInvoice({ channel: 'Amazon', source: 'channel_api' }), true);
  assert.equal(channelIssuesInvoice({ channel: 'Myntra', source: 'channel_push' }), true);
  assert.equal(channelIssuesInvoice({ channel: 'Amazon', source: 'manual' }), false);
  assert.equal(channelIssuesInvoice({ channel: 'Shopify', source: 'channel_api' }), false);
});

test('the GST page and the Orders page hide the OMS invoice buttons for channel-invoiced orders', () => {
  const gst = fs.readFileSync(new URL('../pages/admin/GstInvoicePage.jsx', import.meta.url), 'utf8');
  const orders = fs.readFileSync(new URL('../pages/admin/OrdersPage.jsx', import.meta.url), 'utf8');
  assert.match(gst, /isChannelManaged\(order\) \? packetIdOf\(order\) : !channelIssuesInvoice\(order\)/);
  assert.match(orders, /can\(PERMISSIONS\.FINANCE_VIEW\) && !channelIssuesInvoice\(order\)/);
});
