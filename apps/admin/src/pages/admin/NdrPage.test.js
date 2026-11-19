import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./NdrPage.jsx', import.meta.url), 'utf8');

test('NDR Order column shows Shopify channel order id with internal SHP id under it', () => {
  assert.match(page, /row\.channelOrderNo \|\| row\.orderNo/);
  assert.match(page, /row\.channelOrderNo && row\.channelOrderNo !== row\.orderNo/);
});
