import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAmazonCallback } from './amazonAuth.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('Amazon redirect with code, seller id and state is ready to send to OMSKing', () => {
  const out = readAmazonCallback('?state=S1&selling_partner_id=A1F9Y5L2KINW89&spapi_oauth_code=ANcode&mws_auth_token=');
  assert.deepEqual(out, { kind: 'ready', body: { state: 'S1', code: 'ANcode', sellingPartnerId: 'A1F9Y5L2KINW89' } });
});

test('a seller who denies on Amazon gets a friendly message and nothing is sent', () => {
  const out = readAmazonCallback('?error=access_denied&error_description=User%20denied&state=S1');
  assert.equal(out.kind, 'denied');
  assert.match(out.message, /not connected/i);
  assert.equal(out.body, undefined);
});

test('a redirect without a code or state is reported as incomplete', () => {
  assert.equal(readAmazonCallback('?state=S1&selling_partner_id=A1F9Y5L2KINW89').kind, 'incomplete');
  assert.equal(readAmazonCallback('?spapi_oauth_code=x&selling_partner_id=A1F9Y5L2KINW89').kind, 'incomplete');
  assert.equal(readAmazonCallback('').kind, 'incomplete');
});

test('the Amazon tab offers Authorize with Amazon and keeps the manual Save and Test buttons', () => {
  const src = read('../components/channels/ChannelSetup.jsx');
  assert.match(src, /Authorize with Amazon/);
  assert.match(src, /\/channels\/amazon\/authorize/);
  assert.match(src, /Test connection/);
  assert.match(src, /onClick=\{\(\) => save\(channel\)\}/);
});

test('the callback route is registered under the merchant admin routes', () => {
  const src = read('../router/index.jsx');
  assert.match(src, /path: '\/channels\/amazon\/callback'/);
  assert.match(src, /AmazonAuthCallbackPage/);
});
