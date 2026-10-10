import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../pages/admin/SubscriptionPage.jsx', import.meta.url), 'utf8');
const print = css.slice(css.indexOf('@media print'), css.indexOf('@keyframes admin-rise'));

test('the subscription print view is one A4 sheet', () => {
  assert.match(css, /@page\s*\{[^}]*size:\s*A4 portrait;/);
  assert.match(print, /html,\s*body\s*\{[^}]*height:\s*auto !important;/);
  assert.match(print, /min-height:\s*0 !important;/);
  assert.match(print, /body:has\(\.bill-overlay\)\s*>\s*:not\(\.bill-overlay\)/);
  assert.match(print, /\.bill-actions\s*\{[^}]*display:\s*none !important;/);
  assert.match(print, /overflow:\s*visible !important;/);
  assert.equal(print.includes('min-height: 100dvh'), false);
  assert.equal(print.includes('min-height: 100vh'), false);
});

test('I have paid stays disabled until a UPI id is saved', () => {
  assert.match(
    page,
    /disabled=\{busy \|\| !upi\?\.upiId \|\| reference\.trim\(\)\.length < 6\}/,
  );
});
