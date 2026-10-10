import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../pages/admin/NotificationsPage.jsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../pages/admin/SettingsPage.jsx', import.meta.url), 'utf8');

test('saved notification secrets stay blank and say to leave the field blank', () => {
  assert.match(page, /useState\(''\)/);
  assert.match(page, /setBotToken\(''\)/);
  assert.match(page, /setGmailAppPassword\(''\)/);
  assert.match(page, /setWhatsappToken\(''\)/);
  assert.match(page, /value=\{botToken\}/);
  assert.match(page, /value=\{gmailAppPassword\}/);
  assert.match(page, /value=\{whatsappToken\}/);
  assert.match(page, /Leave blank to keep/);
  assert.equal(page.includes('value={data.data?.botToken'), false);
  assert.equal(page.includes('value={data.data?.gmailAppPassword'), false);
  assert.equal(page.includes('value={data.data?.whatsappToken'), false);
  assert.match(settings, /gmailAppPassword: ''/);
  assert.match(settings, /Leave blank to keep/);
});
