import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedContactWarning, VENDOR_RENAME_NOTE } from './vendorContacts.js';

test('no warning when phone and email are not shared', () => {
  assert.equal(sharedContactWarning(undefined), '');
  assert.equal(sharedContactWarning({ phone: [], email: [] }), '');
});

test('warning names the vendors that share the phone or email', () => {
  assert.equal(
    sharedContactWarning({ phone: ['ABL'], email: [] }),
    'Same phone is also used by ABL.',
  );
  assert.equal(
    sharedContactWarning({ phone: ['ABL', 'JP Studio'], email: ['ABL'] }),
    'Same phone is also used by ABL, JP Studio. Same email is also used by ABL.',
  );
});

test('rename note says Shopify is not changed', () => {
  assert.match(VENDOR_RENAME_NOTE, /not change.*Shopify/i);
});
