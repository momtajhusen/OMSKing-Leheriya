import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('a shared confirm dialog asks before anything is deleted', () => {
  const dialog = read('../../components/ui/ConfirmDialog.jsx');
  assert.match(dialog, /<Modal/);
  assert.match(dialog, /variant="destructive"/);
  assert.match(dialog, /await onConfirm\(\)/);
  assert.match(dialog, /disabled=\{busy\}/);
});

test('the user delete dialog lists linked data and needs the confirm box ticked', () => {
  const dialog = read('../../components/users/UserDeleteDialog.jsx');
  assert.match(dialog, /api\.get\(`\/users\/\$\{user\.id\}\/delete-impact`\)/);
  assert.match(dialog, /type="checkbox"/);
  assert.match(dialog, /confirmDisabled=\{[^}]*needsConfirm && !ack/);
  assert.match(dialog, /confirmLinkedData: true/);
  assert.match(dialog, /impact\.removed\.map/);
  assert.match(dialog, /impact\.kept\.map/);
  const confirm = read('../../components/ui/ConfirmDialog.jsx');
  assert.match(confirm, /disabled=\{busy \|\| confirmDisabled\}/);
});

test('Users & Roles can delete a user, but not your own login', () => {
  const page = read('./UsersRolesPage.jsx');
  assert.match(page, /<UserDeleteDialog/);
  assert.match(page, /row\.id !== user\?\.id/);
  assert.match(page, /lastSeen\(row\.lastLogin\)/);
});

test('the Authentication directory lets you edit or delete a user and shows a readable last login', () => {
  const page = read('./AuthPage.jsx');
  const directory = page.slice(page.indexOf('User directory'), page.indexOf("activeTab === 'sessions'"));
  assert.match(directory, /<TableHead>Actions<\/TableHead>/);
  const target = directory.match(/navigate\('([^']+)'\)/)?.[1];
  assert.ok(target, 'Edit navigates somewhere');
  assert.match(read('../../router/index.jsx'), new RegExp(`path: '${target}'`), `${target} must be a real route`);
  assert.match(page, /<UserDeleteDialog/);
  assert.match(directory, /lastSeen\(row\.lastLogin\)/);
  assert.match(page, /lastSeen\(session\.lastActive\)/);
  assert.match(page, /lastSeen\(key\.lastUsed\)/);
  assert.doesNotMatch(directory, /\{row\.lastLogin\}/);
});

test('last seen reads as a date and time, or Never', async () => {
  const { lastSeen } = await import('../../utils/format.js');
  assert.equal(lastSeen('Never'), 'Never');
  assert.equal(lastSeen(null), 'Never');
  assert.equal(lastSeen(''), 'Never');
  assert.match(lastSeen('2026-10-09T03:47:18.459Z'), /^\d{2} Oct 2026, \d{2}:\d{2} (AM|PM)$/);
});

test('Master SKU rows have Delete next to Edit', () => {
  const page = read('./MasterSkuPage.jsx');
  assert.match(page, /api\.delete\(`\/master-skus\/\$\{removing\.id\}`\)/);
  assert.match(page, /<ConfirmDialog/);
  assert.match(page, /data\.data\?\.deleted/);
});

test('every HSN row can be edited and deleted from Tax settings', () => {
  const tax = read('../../components/settings/TaxSettings.jsx');
  assert.doesNotMatch(tax, /hsnPreview\.slice\(0, 8\)/, 'all saved codes are listed, not the first 8');
  assert.match(tax, /api\.patch\(`\/settings\/tax\/hsn\/\$\{/);
  assert.match(tax, /api\.delete\(`\/settings\/tax\/hsn\/\$\{/);
  assert.match(tax, /<ConfirmDialog/);
});

test('a saved channel can be disconnected after a confirm', () => {
  const setup = read('../../components/channels/ChannelSetup.jsx');
  assert.match(setup, /api\.delete\(`\/channels\/\$\{/);
  assert.match(setup, /<ConfirmDialog/);
  assert.match(setup, /Disconnect/);
});

test('platform can rename or delete a subscriber, and undo a payment marked paid by mistake', () => {
  const tenants = read('./TenantMgmtPage.jsx');
  assert.match(tenants, /api\.patch\(`\/tenants\/\$\{renaming\.id\}`, \{ name/);
  assert.match(tenants, /api\.delete\(`\/tenants\/\$\{removing\.id\}`\)/);
  assert.match(tenants, /<ConfirmDialog/);
  const plans = read('../platform/PlatformPlansPage.jsx');
  assert.match(plans, /api\.delete\(`\/pricing\/subscriptions\/\$\{/);
  assert.match(plans, /Undo paid/);
});
