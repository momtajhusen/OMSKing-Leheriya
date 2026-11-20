import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const store = fs.readFileSync(new URL('./channelStore.js', import.meta.url), 'utf8');
const setup = fs.readFileSync(new URL('../components/channels/ChannelSetup.jsx', import.meta.url), 'utf8');

test('partial hydrate merges so one channel save cannot wipe Amazon or Myntra', () => {
  assert.match(store, /const nextConn = partial \? \{ \.\.\.connections \} : \{\}/);
  assert.match(store, /partial: merge rows/);
  assert.match(setup, /hydrate\(\[data\.data\], \{ partial: true \}\)/);
  assert.equal((setup.match(/hydrate\(\[data\.data\], \{ partial: true \}\)/g) || []).length, 2);
});

test('full GET /channels still replaces the map so disconnect removes a channel', () => {
  assert.match(store, /full list \(GET \/channels\): replace/);
  assert.match(setup, /hydrate\(data\.data \|\| \[\]\)/);
});

test('empty full hydrate does not wipe existing connections', () => {
  assert.match(store, /An empty full replace is ignored/);
  assert.match(store, /!partial && !list\.length && Object\.keys\(connections\)\.length/);
});

test('Dashboard force-refreshes connected channel status', () => {
  const dash = fs.readFileSync(new URL('../pages/admin/DashboardPage.jsx', import.meta.url), 'utf8');
  const hook = fs.readFileSync(new URL('../hooks/useConnectedChannels.js', import.meta.url), 'utf8');
  assert.match(dash, /useConnectedChannels\(\{ refresh: true \}\)/);
  assert.match(hook, /force = false/);
  assert.match(hook, /force: refresh/);
});
