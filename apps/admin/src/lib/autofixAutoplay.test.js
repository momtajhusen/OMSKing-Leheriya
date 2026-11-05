import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoplayPhase, autoplayStep, elapsedLabel, logRun, playTarget, rejectedRun, shouldAutoApply, shouldAutoVerify, targetReached } from './autofixAutoplay.js';

const finished = (extra) => ({ id: 'r1', messageId: 'm1', running: false, error: '', patchFile: null, applied: false, discarded: null, verification: { pass: true }, ...extra });

test('autoplay waits while a run is going, applies a finished change, then starts the next pending task', () => {
  assert.deepEqual(autoplayStep(null), { action: 'start' }, 'no run yet: start the first pending task');
  assert.deepEqual(autoplayStep(finished({ running: true })), { action: 'wait' });
  assert.deepEqual(autoplayStep(finished({ patchFile: '/tmp/r1.patch' })), { action: 'apply' });
  assert.deepEqual(autoplayStep(finished({ patchFile: '/tmp/r1.patch', applied: true })), { action: 'start' });
  assert.deepEqual(autoplayStep(finished()), { action: 'start' }, 'finished without a file change (asked the client, blocked): go on');
});

test('autoplay pauses itself on an error, a discarded change or the same task coming back unchanged', () => {
  assert.equal(autoplayStep(finished({ error: 'agent crashed', patchFile: '/tmp/r1.patch' })).action, 'stop');
  assert.match(autoplayStep(finished({ error: 'agent crashed' })).reason, /agent crashed/);
  assert.equal(autoplayStep(finished({ patchFile: '/tmp/r1.patch', discarded: { reason: 'x' } })).action, 'stop');
  assert.equal(autoplayStep(finished(), 'm1').action, 'stop', 'same message again without a change would loop forever');
  assert.deepEqual(autoplayStep(finished(), 'm0'), { action: 'start' });
});

test('Pending chip has a play/pause button that drives the header Auto-fix loop', () => {
  const pane = fs.readFileSync(new URL('../components/report/ChatPane.jsx', import.meta.url), 'utf8');
  assert.match(pane, /f\.id === 'pending'/);
  assert.match(pane, /autoplay \? setAutoplay\(false\) : setPlayAsk\(true\)/);
  assert.match(pane, /aria-label=\{autoplay \? 'Pause pending auto-fix' : 'Play pending auto-fix one by one'\}/);
  const header = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(header, /autoplayStep\(/);
  assert.match(header, /scope: 'pending'/);
  assert.match(header, /onAutoplayChanged\(/);
});

test('every finished Auto-fix change is applied by itself, once, unless it failed or was discarded', () => {
  assert.equal(shouldAutoApply(finished({ patchFile: '/tmp/r1.patch' })), true);
  assert.equal(shouldAutoApply(finished({ patchFile: '/tmp/r1.patch', running: true })), false, 'still running');
  assert.equal(shouldAutoApply(finished()), false, 'no change to apply');
  assert.equal(shouldAutoApply(finished({ patchFile: '/tmp/r1.patch', applied: true })), false);
  assert.equal(shouldAutoApply(finished({ patchFile: '/tmp/r1.patch', discarded: { reason: 'x' } })), false);
  assert.equal(shouldAutoApply(finished({ patchFile: '/tmp/r1.patch', error: 'agent crashed' })), false, 'a run that stopped with an error is left for a manual look');
  assert.equal(shouldAutoApply(finished({ patchFile: '/tmp/r1.patch' }), 'r1'), false, 'its apply already failed once: no retry loop');
  assert.equal(shouldAutoApply(null), false);
  const header = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(header, /shouldAutoApply\(current, autoApplyFailed\.current\)/);
});

test('the play modal says in plain words what the loop is doing now', () => {
  assert.equal(autoplayPhase(null), 'Picking the next pending message…');
  assert.equal(autoplayPhase(finished({ running: true, state: 'preparing' })), 'Checking the Report inbox…');
  assert.equal(autoplayPhase(finished({ running: true, state: 'starting' })), 'Starting the Cursor agent…');
  assert.equal(autoplayPhase(finished({ running: true, state: 'running', message: 'Logo is blurry' })), 'Fixing "Logo is blurry"');
  assert.equal(autoplayPhase(finished({ patchFile: '/tmp/r1.patch' })), 'Applying the fix to your files…');
  assert.equal(autoplayPhase(finished({ patchFile: '/tmp/r1.patch', applied: true })), 'Picking the next pending message…');
});

test('each run of the play session is listed once with its latest result', () => {
  let log = logRun([], finished({ running: true, message: 'Logo is blurry' }));
  assert.deepEqual(log, [{ id: 'r1', messageId: 'm1', message: 'Logo is blurry', result: 'Fixing', tone: 'busy' }]);
  log = logRun(log, finished({ message: 'Logo is blurry', patchFile: '/tmp/r1.patch', applied: true, changedFiles: ['a.js'] }));
  assert.equal(log.length, 1);
  assert.deepEqual(log[0], { id: 'r1', messageId: 'm1', message: 'Logo is blurry', result: 'Applied · 1 file changed', tone: 'done' });
  log = logRun(log, { ...finished({ error: 'agent crashed' }), id: 'r2', messageId: 'm2', message: 'Price wrong' });
  assert.deepEqual(log.map((e) => [e.id, e.tone]), [['r2', 'error'], ['r1', 'done']], 'newest first');
  assert.match(log[0].result, /agent crashed/);
  assert.equal(logRun(log, null), log);
  assert.deepEqual(logRun([], finished({ messageId: null })), [], 'a run that has not picked a task yet is not listed');
});

test('while play is on the chat shows a centered live status modal and asks for fresh counts', () => {
  const pane = fs.readFileSync(new URL('../components/report/ChatPane.jsx', import.meta.url), 'utf8');
  assert.match(pane, /\{autoplay && <AutoplayStatusModal/);
  assert.match(pane, /params\.fresh = 1/);
  assert.match(pane, /onAutoplayStatus\(/);
  const modal = fs.readFileSync(new URL('../components/report/AutoplayStatusModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /Pending left/);
  assert.match(modal, /setAutoplay\(false\)/);
  const header = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(header, /publishAutoplayStatus\(/);
});

test('a run that ended before Play was pressed never pauses the new session', () => {
  const since = Date.parse('2026-11-04T18:30:00Z');
  const old = finished({ error: 'The Auto-fix runner stopped before the agent finished', finishedAt: '2026-11-04T18:29:34Z' });
  assert.deepEqual(autoplayStep(old, null, since), { action: 'start' });
  assert.deepEqual(autoplayStep(finished({ finishedAt: '2026-11-04T18:29:34Z' }), 'm1', since), { action: 'start' }, 'an old run is not a repeat');
  assert.deepEqual(autoplayStep(finished({ patchFile: '/tmp/r1.patch', finishedAt: '2026-11-04T18:29:34Z' }), null, since), { action: 'apply' }, 'an old unapplied change still goes in first');
  assert.equal(autoplayStep({ ...old, finishedAt: '2026-11-04T18:31:00Z' }, null, since).action, 'stop', 'an error inside the session still pauses');
  const header = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(header, /autoplayStep\(current, loop\.current\.prevMessageId, autoplaySince\(\)\)/);
});

test('only a verified change is applied by itself; a change nobody verified pauses play for a manual look', () => {
  const unverified = finished({ patchFile: '/tmp/r1.patch', verification: null });
  assert.equal(shouldAutoApply(unverified), false);
  assert.equal(shouldAutoApply(finished({ patchFile: '/tmp/r1.patch', verification: { pass: false } })), false);
  assert.deepEqual(autoplayStep(unverified), { action: 'verify' }, 'a change nobody verified is verified first, not applied');
  const crashed = autoplayStep({ ...unverified, error: 'agent crashed' });
  assert.equal(crashed.action, 'stop');
});

test('the play modal shows the verification step and a rejected fix as Fix failed, then play goes on', () => {
  assert.equal(autoplayPhase(finished({ running: true, state: 'verifying', verification: null })), 'Checking the fix against the client requirement…');
  assert.equal(autoplayPhase(finished({ running: true, state: 'running', message: 'Logo', verification: { pass: false, attempt: 1 } })), 'Fixing "Logo" again after the review');
  const rejected = finished({ message: 'Logo', verification: { pass: false, attempt: 2, reason: 'logo still blurry' }, note: 'Not verified, marked Fix failed: logo still blurry' });
  assert.deepEqual(logRun([], rejected)[0], { id: 'r1', messageId: 'm1', message: 'Logo', result: 'Not verified, marked Fix failed: logo still blurry', tone: 'error' });
  assert.deepEqual(logRun([], finished({ running: true, state: 'verifying' }))[0].result, 'Verifying against the client requirement');
  assert.deepEqual(autoplayStep(rejected, null), { action: 'start' });
  const modal = fs.readFileSync(new URL('../components/report/AutoplayStatusModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /Client points/);
  assert.match(modal, /verification\?\.requirements/);
});

test('a saved change with no verdict is verified by itself once; Apply fix shows only for a verified change', () => {
  const unverified = finished({ patchFile: '/tmp/r1.patch', verification: null });
  assert.equal(shouldAutoVerify(unverified), true);
  assert.equal(shouldAutoVerify(unverified, 'r1'), false, 'starting its verify already failed once');
  assert.equal(shouldAutoVerify(finished({ patchFile: '/tmp/r1.patch' })), false, 'already verified');
  assert.equal(shouldAutoVerify({ ...unverified, running: true }), false);
  assert.equal(shouldAutoVerify({ ...unverified, error: 'agent crashed' }), false);
  assert.equal(shouldAutoVerify({ ...unverified, applied: true }), false);
  assert.equal(shouldAutoVerify(null), false);
  const header = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(header, /api\.post\('\/dev\/report-autofix\/verify'\)/);
  assert.match(header, /const canApply = [^;]*run\.verification\?\.pass/);
  assert.match(header, /shouldAutoVerify\(current, autoVerifyFailed\.current\)/);
  assert.match(header, />Verify fix</);
});

test('the play modal shows the exact step the runner is on and how long it has taken', () => {
  assert.equal(autoplayPhase(finished({ running: true, state: 'verifying', step: 'Running the tests and build: admin build' })), 'Running the tests and build: admin build');
  assert.equal(autoplayPhase(finished({ running: true, state: 'running', step: 'The fixer agent is working on the message', message: 'Logo' })), 'The fixer agent is working on "Logo"');
  const now = Date.parse('2026-11-04T19:03:05Z');
  assert.equal(elapsedLabel('2026-11-04T19:00:00Z', now), '3:05');
  assert.equal(elapsedLabel('2026-11-04T18:00:00Z', now), '63:05');
  assert.equal(elapsedLabel(null, now), '');
  const left = finished({ message: 'Logo', verification: { pass: false, reason: 'point 2 missing' }, note: 'Left In progress, not verified: point 2 missing' });
  assert.deepEqual(logRun([], left)[0].result, 'Left In progress, not verified: point 2 missing');
  const modal = fs.readFileSync(new URL('../components/report/AutoplayStatusModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /elapsedLabel\(run\?\.stepAt/);
  assert.match(modal, /elapsedLabel\(run\?\.startedAt/);
});

test('Play asks for All or a number; a number above the pending count becomes All', () => {
  assert.deepEqual(playTarget('all', 28), { all: true, count: 28, note: 'All 28 pending messages' });
  assert.deepEqual(playTarget('5', 28), { all: false, count: 5, note: '5 of 28 pending messages' });
  assert.deepEqual(playTarget('40', 28), { all: true, count: 28, note: 'Only 28 pending: all 28 will be fixed' });
  assert.deepEqual(playTarget('28', 28), { all: true, count: 28, note: 'All 28 pending messages' });
  assert.equal(playTarget('0', 28), null, 'nothing to fix is not a choice');
  assert.equal(playTarget('abc', 28), null);
  assert.equal(playTarget('-3', 28), null);
  assert.deepEqual(playTarget('3', null), { all: false, count: 3, note: '3 messages' }, 'pending count not loaded yet');
  assert.deepEqual(playTarget('all', 0), null);
});

test('play stops once the chosen number of messages is Complete; left In progress ones do not count', () => {
  const log = [{ tone: 'done' }, { tone: 'error' }, { tone: 'done' }, { tone: 'busy' }];
  assert.equal(targetReached(log, 2), true);
  assert.equal(targetReached(log, 3), false);
  assert.equal(targetReached(log, null), false, 'All runs until nothing is pending');
  const pane = fs.readFileSync(new URL('../components/report/ChatPane.jsx', import.meta.url), 'utf8');
  assert.match(pane, /<AutoplayStartModal/);
  assert.match(pane, /autoplay \? setAutoplay\(false\) : setPlayAsk\(true\)/);
  const start = fs.readFileSync(new URL('../components/report/AutoplayStartModal.jsx', import.meta.url), 'utf8');
  assert.match(start, /playTarget\(/);
  assert.match(start, /setAutoplay\(true, target\.all \? null : target\.count\)/);
  const header = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(header, /targetReached\(loadAutoplayLog\(\), autoplayTarget\(\)\)/);
  const modal = fs.readFileSync(new URL('../components/report/AutoplayStatusModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /autoplayTarget\(\)/);
});

test('the play modal shows the message being fixed exactly like the chat, with its image, video or voice note', () => {
  const pane = fs.readFileSync(new URL('../components/report/ChatPane.jsx', import.meta.url), 'utf8');
  assert.match(pane, /<AutoplayStatusModal status=\{autoplayStatus\} message=\{messages\.find\(\(m\) => m\.id === autoplayStatus\?\.run\?\.messageId\)\} onOpenImage=\{setLightbox\} mySide=\{mySide\} \/>/);
  const modal = fs.readFileSync(new URL('../components/report/AutoplayStatusModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /<MessageBubble/);
  assert.match(modal, /attachment\?\.kind === 'audio'/);
  assert.match(modal, /cannot listen to voice notes/);
});

test('focusing the Auto-fix message never shows "further up" for a message hidden by the chip filter, and play does not jump at all', () => {
  const pane = fs.readFileSync(new URL('../components/report/ChatPane.jsx', import.meta.url), 'utf8');
  const effect = pane.slice(pane.indexOf('/** Opened for one message (Auto-fix)'), pane.indexOf('const openPage ='));
  assert.match(effect, /if \(autoplay\) \{\s*focused\.current = focus;\s*return;\s*\}/);
  assert.match(effect, /filter !== 'all' && !matchesFilter\(target, filter\)/);
  assert.match(effect, /setFilter\('all'\)/);
  assert.match(effect, /autoplay, filter\]\);/);
});

test('the start modal lists the messages play will fix: the first N for a number, all of them for All', () => {
  const modal = fs.readFileSync(new URL('../components/report/AutoplayStartModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /api\.get\('\/dev\/report-autofix\/queue'\)/);
  assert.match(modal, /queue\.slice\(0, target\.all \? queue\.length : target\.count\)/);
  assert.match(modal, /<MessageBubble/);
  const pane = fs.readFileSync(new URL('../components/report/ChatPane.jsx', import.meta.url), 'utf8');
  assert.match(pane, /<AutoplayStartModal pending=\{filterCount\(counts, 'pending'\)\} messages=\{messages\} mySide=\{mySide\} onOpenImage=\{setLightbox\}/);
});

test('a rejected Apply fix takes the server\'s run: an already applied change counts as done and the button goes away, with no stacked error toasts', () => {
  const applied = finished({ patchFile: '/tmp/r1.patch', applied: true });
  const err = { response: { status: 409, data: { message: 'No finished Auto-fix change is waiting to be applied', data: applied } } };
  assert.deepEqual(rejectedRun(err), applied);
  assert.equal(rejectedRun(new Error('Network Error')), null, 'no answer from the server: nothing to take');
  assert.equal(rejectedRun({ response: { status: 500, data: { message: 'boom' } } }), null);

  const header = fs.readFileSync(new URL('../components/report/AutoFixButton.jsx', import.meta.url), 'utf8');
  assert.match(header, /const latest = rejectedRun\(err\);\s*if \(latest\) setRun\(latest\);/);
  assert.match(header, /if \(latest\?\.applied\) \{\s*toast\.success\([^\n]*\);\s*return true;/, 'already applied: done, not an error');
  assert.match(header, /toast\.error\(apiError\(err, 'Could not apply the fix'\), \{ id: 'autofix-apply'/, 'repeated errors replace one toast');
});
