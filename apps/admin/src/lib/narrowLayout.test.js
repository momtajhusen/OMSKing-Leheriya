import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const LEGAL = ['/terms', '/privacy', '/billing', '/cookies'];

test('shared tables scroll inside the page instead of widening it', () => {
  const table = read('../components/ui/Table.jsx');
  assert.match(table, /overflow-x-auto/);
  assert.match(table, /min-w-0/);
  assert.match(table, /max-w-full/);
});

test('terms, privacy, billing and cookies are public routes', () => {
  const router = read('../router/index.jsx');
  const legal = read('../pages/public/LegalPage.jsx');
  for (const path of LEGAL) {
    assert.match(router, new RegExp(`path: '${path}'`));
    assert.match(legal, new RegExp(`to: '${path}'`));
  }
});

test('the register page and the public footer open every legal page', () => {
  const register = read('../components/layout/AuthLayout.jsx');
  const footer = read('../components/layout/PublicLayout.jsx');
  assert.match(register, /LEGAL_LINKS\.map/);
  assert.match(footer, /LEGAL_LINKS\.map/);
});

test('the subscription page opens every legal page', () => {
  const page = read('../pages/admin/SubscriptionPage.jsx');
  assert.match(page, /LEGAL_LINKS\.map/);
});
