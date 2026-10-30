import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../..');
const read = (rel) => fs.readFileSync(path.join(src, rel), 'utf8');
const dock = read('components/marketing/StickyContactDock.jsx');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walk(full);
  return /\.(jsx?|tsx?)$/.test(entry.name) && !entry.name.endsWith('.test.js') ? [full] : [];
});

test('contact details are Leheriya support, not Coders Alpha', () => {
  assert.match(dock, /export const CONTACT_EMAIL = 'support@leheriya\.com'/);
  assert.match(dock, /export const CONTACT_PHONE_DISPLAY = '011-69296516'/);
  assert.match(dock, /export const CONTACT_PHONE_HREF = 'tel:\+911169296516'/);
  assert.match(dock, /export const CONTACT_WHATSAPP_DISPLAY = '\+91-9873003388'/);
  assert.match(dock, /export const CONTACT_WHATSAPP_HREF = 'https:\/\/wa\.me\/919873003388'/);
  assert.match(dock, /export const CONTACT_HOURS = '11:00 am – 5:00 pm'/);
});

test('no screen shows the old Coders Alpha email or phone', () => {
  for (const file of walk(src)) {
    const source = fs.readFileSync(file, 'utf8');
    const rel = path.relative(src, file);
    assert.doesNotMatch(source, /thecodersalpha@/i, `${rel} has the old email`);
    assert.doesNotMatch(source, /7600201227|76002 01227/, `${rel} has the old phone`);
  }
});

test('call and WhatsApp use their own numbers, and links come from the shared constants', () => {
  assert.match(dock, /href: CONTACT_PHONE_HREF/);
  assert.match(dock, /href: CONTACT_WHATSAPP_HREF/);
  for (const rel of ['components/layout/PublicLayout.jsx', 'pages/public/ContactPage.jsx', 'pages/public/LegalPage.jsx']) {
    const source = read(rel);
    assert.doesNotMatch(source, /href="tel:\+91/, `${rel} has a hardcoded tel link`);
    assert.match(source, /CONTACT_PHONE_HREF/, `${rel} uses the shared call link`);
  }
});

test('contact page shows working hours and the WhatsApp-only number', () => {
  const contact = read('pages/public/ContactPage.jsx');
  assert.match(contact, /title: 'Working hours', value: CONTACT_HOURS/);
  assert.match(contact, /title: 'WhatsApp only', value: CONTACT_WHATSAPP_DISPLAY, href: CONTACT_WHATSAPP_HREF/);
  assert.match(contact, /title: 'Call us', value: CONTACT_PHONE_DISPLAY, href: CONTACT_PHONE_HREF/);
});
