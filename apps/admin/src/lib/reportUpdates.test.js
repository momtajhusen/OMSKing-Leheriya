import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_TOAST,
  actionsFor,
  CHAT_FILTERS,
  eventLabel,
  markOptions,
  markSteps,
  matchesFilter,
  STATUS_META,
  statusChips,
} from './reportUpdates.js';
import { isLocalApp, messagePreview } from './reportChat.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const chat = read('../components/report/ChatPane.jsx');
const inbox = read('../components/report/ReportChat.jsx');
const bubble = read('../components/report/MessageBubble.jsx');

test('developers start and finish work; clients confirm or reopen it (same rules as the API)', () => {
  assert.deepEqual(actionsFor('pending', 'platform'), ['start', 'complete']);
  assert.deepEqual(actionsFor('in_progress', 'platform'), ['complete']);
  assert.deepEqual(actionsFor('done', 'platform'), ['reopen']);
  assert.deepEqual(actionsFor('done', 'tenant'), ['confirm', 'reopen']);
  assert.deepEqual(actionsFor('pending', 'tenant'), ['confirm']);
  assert.deepEqual(actionsFor('confirmed', 'tenant'), ['reopen']);
  assert.deepEqual(actionsFor('confirmed', 'platform'), ['reopen']);
});

test('chat labels say who marked what as pending or fixed, and "you" for your own marks', () => {
  const done = { action: 'complete', status: 'done', title: 'Label not printing', note: 'Pincode check added' };
  assert.equal(eventLabel(done, 'Momtaj', false), 'Momtaj marked "Label not printing" as fixed');
  assert.equal(eventLabel(done, 'Momtaj', true), 'You marked "Label not printing" as fixed');
  assert.equal(eventLabel({ action: 'confirm', title: 'GST' }, 'Ravi', false), 'Ravi confirmed "GST" is fixed');
  assert.equal(eventLabel({ action: 'reopen', title: 'GST' }, 'Ravi', false), 'Ravi marked "GST" as pending again');
  assert.equal(eventLabel({ action: 'start', title: 'GST' }, 'Momtaj', false), 'Momtaj started working on "GST"');
  assert.equal(messagePreview({ text: '', event: done, senderName: 'Momtaj' }), 'Momtaj marked "Label not printing" as fixed');
});

test('the client dropdown offers Pending and Fixed; the developer gets Pending, In progress and Complete', () => {
  const pick = (opts) => opts.map((o) => `${o.id}:${o.action || '-'}:${o.active ? 'on' : 'off'}`);
  assert.deepEqual(pick(markOptions(null, 'tenant')), ['pending:track:off'], 'an untracked message can only be marked pending by the client');
  assert.deepEqual(
    pick(markOptions(null, 'platform', true)),
    ['pending:track:off', 'progress:track_start:off', 'complete:track_complete:off'],
    'the developer can mark any message complete in one step',
  );
  assert.deepEqual(pick(markOptions('pending', 'platform', true)), ['pending:-:on', 'progress:start:off', 'complete:complete:off']);
  assert.deepEqual(pick(markOptions('in_progress', 'platform', true)), ['pending:-:off', 'progress:-:on', 'complete:complete:off']);
  assert.deepEqual(pick(markOptions('done', 'platform', true)), ['pending:reopen:off', 'progress:-:off', 'complete:-:on']);
  assert.deepEqual(pick(markOptions('confirmed', 'platform', true)), ['pending:reopen:off', 'progress:-:off', 'complete:-:on']);
  assert.deepEqual(markOptions(null, 'platform', true).map((o) => o.label), ['Pending', 'In progress', 'Complete']);
  assert.deepEqual(pick(markOptions('pending', 'tenant')), ['pending:-:on', 'fixed:confirm:off']);
  assert.deepEqual(pick(markOptions('done', 'tenant')), ['pending:reopen:off', 'fixed:confirm:off'], 'the client still has to confirm the fix');
  assert.deepEqual(pick(markOptions('confirmed', 'tenant')), ['pending:reopen:off', 'fixed:-:on']);
  assert.equal(STATUS_META.done.label, 'Fixed');
  assert.equal(STATUS_META.pending.label, 'Pending');
});

test('one-step developer marks become "track, then start/complete" calls', () => {
  assert.deepEqual(markSteps('track'), ['track']);
  assert.deepEqual(markSteps('track_start'), ['track', 'start']);
  assert.deepEqual(markSteps('track_complete'), ['track', 'complete']);
  assert.deepEqual(markSteps('complete'), ['complete']);
  assert.equal(ACTION_TOAST.track_complete, 'Marked complete — waiting for the client to confirm');
  assert.equal(ACTION_TOAST.track_start, 'Marked in progress');
});

test('every tracked message shows the developer status, and the client confirmation once given', () => {
  const labels = (status) => statusChips(status, true).map((c) => c.label);
  assert.deepEqual(labels('pending'), ['Developer · Pending']);
  assert.deepEqual(labels('in_progress'), ['Developer · In progress']);
  assert.deepEqual(labels('done'), ['Developer · Complete']);
  assert.deepEqual(labels('confirmed'), ['Developer · Complete', 'Client · Confirmed']);
  assert.deepEqual(labels(null), []);
  assert.ok(statusChips('done', true)[0].hint.includes('waiting for the client'));
  assert.match(bubble, /statusChips\(/);
  assert.match(bubble, /Developer status/, 'the developer menu is titled');
  assert.match(chat, /markSteps\(action\)/);
});

test('developer mark options and the open developer statuses only appear when the app runs on localhost', () => {
  assert.equal(isLocalApp({ hostname: 'localhost' }), true);
  assert.equal(isLocalApp({ hostname: '127.0.0.1' }), true);
  assert.equal(isLocalApp({ hostname: 'omsking.codersalpha.com' }), false);
  assert.equal(isLocalApp(undefined), false);
  for (const status of [null, 'pending', 'in_progress', 'done', 'confirmed']) {
    assert.deepEqual(markOptions(status, 'platform', false), [], `no developer marks on the live site (${status})`);
  }
  assert.deepEqual(markOptions('pending', 'tenant', false).map((o) => o.id), ['pending', 'fixed'], 'the client keeps Pending / Fixed on live');
  assert.deepEqual(statusChips('pending', false), [], 'no open developer status on the live site');
  assert.deepEqual(statusChips('in_progress', false), [], 'no open developer status on the live site');
  assert.deepEqual(statusChips('done', false).map((c) => c.label), ['Developer · Complete'], 'everyone sees Complete on live');
  assert.deepEqual(statusChips('confirmed', false).map((c) => c.label), ['Developer · Complete', 'Client · Confirmed']);
});

test('every login gets the Report button in its header: any admin, vendor or super admin, on localhost too', () => {
  const header = read('../components/layout/AdminHeader.jsx');
  const vendor = read('../components/layout/VendorLayout.jsx');
  assert.match(header, /\{user && <ReportButton mode="merchant" \/>\}/, 'no role or localhost condition in the main header');
  assert.doesNotMatch(header, /isLocalApp/);
  assert.match(vendor, /<ReportButton mode="merchant" \/>/, 'the vendor header has the Report button');
  assert.match(read('../components/layout/PlatformLayout.jsx'), /<ReportButton mode="platform" \/>/);
});

test('on localhost the client chat also gets the developer marks, sent through the developer route', () => {
  assert.match(inbox, /developerUpdatesUrl=\{isLocalApp\(\) && !user\?\.impersonating \? '\/support\/as-developer\/updates' : undefined\}/);
  assert.match(chat, /const markMessage = async \(m, action, asDeveloper = false\)/);
  assert.match(chat, /const url = asDeveloper \? developerUpdatesUrl : updatesUrl;/);
  assert.match(chat, /markedBy: asDeveloper \? 'platform' : mySide/);
  assert.match(chat, /onDevMark=\{developerUpdatesUrl \? \(m, action\) => markMessage\(m, action, true\) : undefined\}/);
  assert.match(bubble, /const devOptions = onDevMark \? markOptions\(message\.update\?\.status \|\| null, 'platform'\) : \[\];/);
  assert.match(bubble, /\{ key: 'dev', title: 'Developer status', items: devOptions, apply: onDevMark \}/, 'a Developer status section that marks through onDevMark');
  assert.match(bubble, /section\.apply\(message, o\.action\)/);
});

test('the chat filters keep messages by status or by who made the last mark', () => {
  assert.deepEqual(CHAT_FILTERS.map((f) => f.id), ['all', 'pending', 'fixed', 'developer', 'client']);
  const plain = { id: '1', text: 'hi', update: null };
  const open = { id: '2', update: { status: 'in_progress', markedBy: 'platform' } };
  const fixed = { id: '3', update: { status: 'done', markedBy: 'platform' } };
  const confirmed = { id: '4', update: { status: 'confirmed', markedBy: 'tenant' } };
  const reported = { id: '5', update: { status: 'pending', markedBy: 'tenant' } };
  const event = { id: '6', event: { action: 'complete' }, update: { status: 'done', markedBy: 'platform' } };
  const rows = [plain, open, fixed, confirmed, reported, event];
  const ids = (filter) => rows.filter((m) => matchesFilter(m, filter)).map((m) => m.id);
  assert.deepEqual(ids('all'), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(ids('pending'), ['2', '5']);
  assert.deepEqual(ids('fixed'), ['3', '4']);
  assert.deepEqual(ids('developer'), ['2', '3']);
  assert.deepEqual(ids('client'), ['4', '5']);
});

test('marks live on each message: no Updates tab, cards or pending bar, just a scrolling filter row', () => {
  assert.doesNotMatch(chat, /UpdatesBoard|role="tablist"|pendingSummary|Still open/);
  assert.doesNotMatch(inbox, /UpdatesBoard|AllUpdatesPane|all-updates/);
  assert.ok(!fs.existsSync(new URL('../components/report/UpdatesBoard.jsx', import.meta.url)));
  assert.match(chat, /CHAT_FILTERS/);
  assert.match(chat, /overflow-x-auto/);
  assert.match(bubble, /aria-label="Message options"/);
  assert.match(bubble, /markOptions/);
  assert.match(inbox, /openUpdates/);
});

test('messages can be deleted WhatsApp-style and leave an English "deleted" label', () => {
  assert.equal(messagePreview({ deleted: true, text: '', senderName: 'Ravi' }), 'This message was deleted');
  assert.match(bubble, /This message was deleted/);
  assert.match(bubble, /You deleted this message/);
  assert.match(bubble, /Delete for everyone/);
  assert.match(chat, /api\.delete\(`\$\{listUrl\}\/\$\{m\.id\}`\)/);
});

test('the report window is taller and message bubbles are more compact, so more messages fit', () => {
  const heights = [...inbox.matchAll(/sm:h-\[min\((\d+)vh,(\d+)px\)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(heights.length, 2);
  heights.forEach(([vh, px]) => {
    assert.ok(vh >= 94, `modal height ${vh}vh should be at least 94vh`);
    assert.ok(px >= 900, `modal cap ${px}px should be at least 900px`);
  });
  assert.doesNotMatch(bubble, /text-\[14\.2px\]|max-h-\[320px\]/);
  assert.match(bubble, /text-\[13\.5px\]/);
});

test('marking "pending" again on the client side opens a reply so they can add a voice note or photo', () => {
  assert.match(chat, /action === 'reopen' && mySide === 'tenant'[\s\S]{0,120}startReply/);
});

test('the client-facing Report chat is branded Developer Support, not OMSKing', () => {
  const chat = read('../components/report/ReportChat.jsx');
  const button = read('../components/report/ReportButton.jsx');
  assert.match(chat, /title="Developer Support"/);
  assert.match(chat, /developer support team/);
  assert.match(button, /New reply from Developer Support/);
  assert.match(button, /Report a problem to Developer Support/);
  for (const source of [chat, button]) {
    assert.doesNotMatch(source, /['"`][^'"`\n]*OMSKing[^'"`\n]*['"`]/, 'no visible OMSKing label left');
  }
});

test('a completed message\'s detail tooltip says in short Hinglish what the issue was and what fix was applied', () => {
  const summary = { issue: 'Vendor dropdown khaali tha', fix: 'Row me Assign button lagaya' };
  for (const status of ['done', 'confirmed']) {
    const [developer] = statusChips(status, true, summary);
    assert.equal(developer.hint, `${statusChips(status, true)[0].hint}\nIssue kya tha: Vendor dropdown khaali tha\nFix kya kiya: Row me Assign button lagaya`);
  }
  assert.doesNotMatch(statusChips('done', true, { issue: 'Page slow tha', fix: '' })[0].hint, /Fix kya kiya/);
  assert.doesNotMatch(statusChips('in_progress', true, summary)[0].hint, /Issue kya tha/, 'only completed tasks get the summary');
  assert.match(statusChips('confirmed', false, summary)[0].hint, /\nIssue kya tha: Vendor dropdown khaali tha\nFix kya kiya: Row me Assign button lagaya$/, 'the live site shows it too');
});

test('each message gets the summary saved on its live update, or the local task list one on localhost', () => {
  const pane = fs.readFileSync(new URL('../components/report/ChatPane.jsx', import.meta.url), 'utf8');
  const bubble = fs.readFileSync(new URL('../components/report/MessageBubble.jsx', import.meta.url), 'utf8');
  const hook = fs.readFileSync(new URL('./reportSummaries.js', import.meta.url), 'utf8');
  assert.match(pane, /const summaries = useTaskSummaries\(\);/);
  assert.match(pane, /summary=\{pickSummary\(m\.update, summaries\[m\.id\]\)\}/);
  assert.match(bubble, /statusChips\(message\.update\.status, undefined, summary\)/);
  assert.match(hook, /isLocalApp\(\)/);
  assert.match(hook, /'\/dev\/report-autofix\/summaries'/);
});
