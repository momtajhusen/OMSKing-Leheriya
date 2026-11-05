import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFICATION_EVENTS } from '../../constants/notificationEvents.js';

const page = fs.readFileSync(new URL('./NotificationsPage.jsx', import.meta.url), 'utf8');

test('Owner Alert on Vendor Assignment is configurable like the other events and starts switched on', () => {
  const owner = NOTIFICATION_EVENTS.find((row) => row.id === 'NOT-009');
  assert.equal(owner.isOwnerAlert, false);
  assert.deepEqual(owner.channels, { telegram: true, email: true, whatsapp: true, other: false });
  assert.equal(NOTIFICATION_EVENTS.some((row) => row.isOwnerAlert), false);
});

test('the legend no longer promises an Always On owner alert', () => {
  assert.doesNotMatch(page, /Always On\)/);
});
