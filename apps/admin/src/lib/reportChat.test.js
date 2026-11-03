import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasGap,
  pageSizeFor,
  mergeMessages,
  dayLabel,
  formatDuration,
  fileKind,
  clipboardFiles,
  messagePreview,
  recorderMime,
  mediaSrc,
  MAX_FILE_MB,
} from './reportChat.js';

const header = fs.readFileSync(new URL('../components/layout/AdminHeader.jsx', import.meta.url), 'utf8');
const platform = fs.readFileSync(new URL('../components/layout/PlatformLayout.jsx', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../components/report/ChatPane.jsx', import.meta.url), 'utf8');

test('polled messages merge by id, keep older pages and stay in time order', () => {
  const older = [{ id: 'a', text: 'one' }, { id: 'b', text: 'two', readAt: null }];
  const polled = [{ id: 'b', text: 'two', readAt: '2026-11-03T05:00:00Z' }, { id: 'c', text: 'three' }];
  const merged = mergeMessages(older, polled);
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
  assert.equal(merged[1].readAt, '2026-11-03T05:00:00Z');

  const withPending = mergeMessages([{ id: 'tmp-1', pending: true, text: 'sending' }], [{ id: 'a', text: 'one' }]);
  assert.deepEqual(withPending.map((m) => m.id), ['a', 'tmp-1'], 'unsent messages stay at the bottom');
});

test('day dividers read Today, Yesterday, weekday or date like WhatsApp', () => {
  const now = new Date('2026-11-03T10:00:00');
  assert.equal(dayLabel('2026-11-03T08:00:00', now), 'Today');
  assert.equal(dayLabel('2026-11-02T23:00:00', now), 'Yesterday');
  assert.equal(dayLabel('2026-10-30T10:00:00', now), 'Friday');
  assert.equal(dayLabel('2026-09-01T10:00:00', now), '1 Sep 2026');
});

test('voice note durations print as m:ss', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(7.4), '0:07');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(undefined), '0:00');
});

test('only photos, videos and voice notes can be attached', () => {
  assert.equal(fileKind({ type: 'image/png' }), 'image');
  assert.equal(fileKind({ type: 'video/quicktime' }), 'video');
  assert.equal(fileKind({ type: 'audio/webm' }), 'audio');
  assert.equal(fileKind({ type: 'application/pdf' }), null);
  assert.equal(MAX_FILE_MB.video, 50);
});

test('Ctrl+V of a screenshot gives the image file, text paste gives none', () => {
  const png = { type: 'image/png', name: 'image.png' };
  const shot = { items: [{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/png', getAsFile: () => png }], files: [] };
  assert.deepEqual(clipboardFiles(shot), [png]);
  const text = { items: [{ kind: 'string', type: 'text/plain' }], files: [] };
  assert.deepEqual(clipboardFiles(text), []);
  const fromFinder = { items: [], files: [{ type: 'video/mp4', name: 'a.mp4' }, { type: 'application/zip', name: 'b.zip' }] };
  assert.deepEqual(clipboardFiles(fromFinder).map((f) => f.name), ['a.mp4']);
  assert.deepEqual(clipboardFiles(null), []);
});

test('reply quotes and inbox rows describe media without text', () => {
  assert.equal(messagePreview({ text: 'Label failed' }), 'Label failed');
  assert.equal(messagePreview({ text: '', attachment: { kind: 'image' } }), 'Photo');
  assert.equal(messagePreview({ text: '', kind: 'audio' }), 'Voice message');
  assert.equal(messagePreview({ text: '', attachment: { kind: 'video' } }), 'Video');
});

test('the recorder picks a format this browser can record', () => {
  assert.equal(recorderMime({ isTypeSupported: (t) => t === 'audio/mp4' }), 'audio/mp4');
  assert.equal(recorderMime({ isTypeSupported: (t) => t.startsWith('audio/webm') }), 'audio/webm;codecs=opus');
  assert.equal(recorderMime(undefined), '');
});

test('signed media paths load from the API host in production and as-is in dev', () => {
  const url = '/api/v1/support/media/abc?exp=1&sig=f';
  assert.equal(mediaSrc(url, 'https://omskingapi.codersalpha.com/api/v1'), `https://omskingapi.codersalpha.com${url}`);
  assert.equal(mediaSrc(url, '/api/v1'), url);
  assert.equal(mediaSrc('blob:http://localhost/1', 'https://x.com/api/v1'), 'blob:http://localhost/1');
});

test('Report button sits in the merchant header and the platform header', () => {
  assert.match(header, /<ReportButton/);
  assert.match(platform, /<ReportButton/);
  assert.match(chat, /onPaste=/);
  assert.match(chat, /MediaRecorder/);
});

test('a page holds only what fits on screen: a short pane loads a handful, a tall one a few more', () => {
  assert.equal(pageSizeFor(0), 8, 'never fewer than a handful');
  assert.equal(pageSizeFor(400), 12);
  assert.equal(pageSizeFor(800), 22);
  assert.equal(pageSizeFor(10000), 50, 'capped');
});

test('a poll that shares nothing with the loaded chat has a hole to fill', () => {
  const loaded = [{ id: 'a1' }, { id: 'a2' }, { id: 'tmp', pending: true }];
  assert.equal(hasGap(loaded, [{ id: 'a2' }, { id: 'a3' }], true), false, 'overlaps');
  assert.equal(hasGap(loaded, [{ id: 'a7' }, { id: 'a8' }], true), true, 'many new messages since the last poll');
  assert.equal(hasGap(loaded, [{ id: 'a7' }, { id: 'a8' }], false), false, 'nothing older exists');
  assert.equal(hasGap([], [{ id: 'a7' }], true), false, 'first load is not a hole');
});

test('the chat loads by screenful: no fixed 50-message pages, older pages on scroll up, polls stay small', () => {
  assert.doesNotMatch(chat, /limit: 50/);
  assert.match(chat, /pageSizeFor\(/);
  assert.match(chat, /params: \{ limit: pageSize\.current, before:/, 'older messages come one screenful at a time');
  assert.match(chat, /hasGap\(/, 'a long gap between polls is filled, not left as a hole');
  assert.match(chat, /scrollHeight <= el\.clientHeight/, 'keeps loading only until the pane can scroll');
});
