import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_AUTO_KEY, BACKUP_LAST_KEY, BACKUP_SAVED_KEY, backupDue, driveText, formatBytes, nextAutoBackup, nextAutoText, readBackupPrefs, savedHere, takeBackupLock,
} from './dbBackup.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

function memoryStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test('automatic backup runs once a day in the evening, catches up on open after a missed day, and can be turned off', () => {
  const at = (s) => new Date(s);
  assert.equal(backupDue({ lastAt: '', now: at('2026-11-06T10:00:00') }), true, 'never backed up: take one now');
  assert.equal(backupDue({ lastAt: '2026-11-06T09:00:00', now: at('2026-11-06T19:00:00') }), false, 'already one today');
  assert.equal(backupDue({ lastAt: '2026-11-05T18:30:00', now: at('2026-11-06T10:00:00') }), false, 'yesterday evening, wait for this evening');
  assert.equal(backupDue({ lastAt: '2026-11-05T18:30:00', now: at('2026-11-06T18:05:00') }), true, 'evening run');
  assert.equal(backupDue({ lastAt: '2026-11-04T18:30:00', now: at('2026-11-06T09:00:00') }), true, 'missed a day: catch up on open');
  assert.equal(backupDue({ lastAt: '', now: at('2026-11-06T19:00:00'), auto: false }), false);
});

test('next automatic backup time follows the same daily rule; sizes read in KB/MB', () => {
  const at = (s) => new Date(s);
  assert.equal(nextAutoBackup({ lastAt: '', now: at('2026-11-06T10:00:00') }).now, true);
  assert.deepEqual(nextAutoBackup({ lastAt: '2026-11-06T18:10:00', now: at('2026-11-06T20:00:00') }).at, at('2026-11-07T18:00:00'), 'done today: tomorrow evening');
  assert.deepEqual(nextAutoBackup({ lastAt: '2026-11-05T18:10:00', now: at('2026-11-06T09:00:00') }).at, at('2026-11-06T18:00:00'), 'done yesterday: this evening');
  assert.deepEqual(nextAutoBackup({ lastAt: '2026-11-05T09:00:00', now: at('2026-11-05T09:30:00') }).at, at('2026-11-06T09:00:00'), 'morning backup: due again 24h later, before the evening');
  assert.equal(nextAutoBackup({ lastAt: '', auto: false }), null);
  assert.equal(nextAutoText(null), 'Off on this computer');
  assert.match(nextAutoText({ now: false, at: at('2026-11-06T18:00:00') }, at('2026-11-06T09:00:00')), /^Today, /);
  assert.match(nextAutoText({ now: false, at: at('2026-11-07T18:00:00') }, at('2026-11-06T20:00:00')), /^Tomorrow, /);
  assert.equal(formatBytes(0), '—');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(38.4 * 1024 * 1024), '38.4 MB');
});

test('the history marks which backups were saved on this computer', () => {
  const store = memoryStore({ [BACKUP_SAVED_KEY]: JSON.stringify(['omsking-backup-2026-11-06-1830.archive.gz']) });
  assert.equal(savedHere(store).has('omsking-backup-2026-11-06-1830.archive.gz'), true);
  assert.equal(savedHere(memoryStore({ [BACKUP_SAVED_KEY]: 'not json' })).size, 0);
  const card = read('../components/platform/DatabaseBackupCard.jsx');
  ['Last backup', 'Next automatic backup', 'Google Drive', 'Recent backups', 'This computer', 'Download backup now'].forEach((text) => assert.match(card, new RegExp(text)));
  assert.match(read('../hooks/useAutoBackup.js'), /trigger: 'auto'/);
});

test('backup prefs and the cross-tab lock live in this browser only', () => {
  const store = memoryStore({ [BACKUP_LAST_KEY]: '2026-11-05T18:30:00.000Z', [BACKUP_AUTO_KEY]: 'off' });
  assert.deepEqual(readBackupPrefs(store), { lastAt: '2026-11-05T18:30:00.000Z', auto: false });
  assert.equal(readBackupPrefs(memoryStore()).auto, true, 'on by default');
  const lock = memoryStore();
  assert.equal(takeBackupLock(lock, 1000), true);
  assert.equal(takeBackupLock(lock, 2000), false, 'second tab waits');
  assert.equal(takeBackupLock(lock, 1000 + 6 * 60 * 1000), true, 'stale lock expires');
});

test('Drive result text and the backup card are wired into platform Settings and the platform layout', () => {
  assert.equal(driveText('uploaded'), 'Also saved to Google Drive.');
  assert.equal(driveText('failed', 'Drive refused the upload (403)'), 'Google Drive upload failed: Drive refused the upload (403).');
  assert.equal(driveText('not_connected'), 'Google Drive is not connected.');
  assert.match(read('../pages/platform/PlatformOpsPage.jsx'), /<DatabaseBackupCard \/>/);
  assert.match(read('../components/layout/PlatformLayout.jsx'), /useAutoBackup\(.*tenants\.manage/);
  assert.match(read('../components/platform/DatabaseBackupCard.jsx'), /Download backup now/);
});
