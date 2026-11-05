import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isLocalHost } from './devHost.js';

test('isLocalHost is true only for the local machine', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', '::1', 'LOCALHOST']) assert.equal(isLocalHost(host), true, host);
  for (const host of ['omsking.codersalpha.com', 'localhost.evil.com', '127.0.0.2', '192.168.1.5', '']) assert.equal(isLocalHost(host), false, host);
});

test('the auto-fix button sits next to Report and renders nothing off localhost', () => {
  const header = fs.readFileSync(new URL('../components/layout/AdminHeader.jsx', import.meta.url), 'utf8');
  assert.match(header, /<ReportButton mode="merchant" \/>\}\s*\{user && <AutoFixButton \/>\}/);
  const button = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(button, /if \(!isLocalHost\(window\.location\.hostname\)\) return null;/);
});

test('the button flags a client reply that is ready to fix and keeps checking while idle', () => {
  const button = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(button, /const replyReady = next\?\.kind === 'replied';/);
  assert.match(button, /\{replyReady && !running && \(/);
  assert.match(button, /setInterval\(load, running \|\| autoplay \? POLL_MS : IDLE_POLL_MS\)/);
});

test('a finished Auto-fix offers Apply fix, which copies the change into the main folder', () => {
  const button = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(button, /api\.post\('\/dev\/report-autofix\/apply'\)/);
  assert.match(button, /\{canApply && \(/);
});

test('while a finished change waits, Auto-fix is blocked and the change can be applied or discarded with a reason', () => {
  const button = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(button, /const hasChange = Boolean\(run && !run\.running && run\.patchFile && !run\.applied && !run\.discarded\);/);
  assert.match(button, /disabled=\{running \|\| hasChange \|\| Boolean\(busy\)\}/);
  assert.match(button, /Apply or discard the last change first/);
  assert.match(button, /window\.prompt\('Why discard this Auto-fix change\?/);
  assert.match(button, /api\.post\('\/dev\/report-autofix\/discard', \{ reason \}\)/);
  assert.match(button, />Discard</);
});

test('the button says when it will finish a task an interrupted run left In progress', () => {
  const button = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(button, /next\.kind === 'resume'\) return `Finishes "\$\{next\.message\}", left In progress by a stopped run`/);
});
