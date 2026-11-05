import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEM_STATUSES, REPORT_TABS, countItems, filterItems, historyEntries, itemStatus, updateItems,
} from './reportTabs.js';

const at = (min) => new Date(Date.UTC(2026, 10, 5, 10, min)).toISOString();

test('the report has Chat, Updates and History tabs, and Updates filters by every status', () => {
  assert.deepEqual(REPORT_TABS.map((t) => t.id), ['chat', 'updates', 'history']);
  assert.deepEqual(
    ITEM_STATUSES.map((s) => s.label),
    ['All', 'Pending', 'In progress', 'Waiting for client', 'Needs input', 'Blocked', 'Complete'],
  );
});

test('each update gets one status: Complete, In progress, Pending, Waiting for client, Needs input or Blocked', () => {
  assert.equal(itemStatus({ id: 'a', side: 'tenant', update: { id: 'u', status: 'done' } }), 'complete');
  assert.equal(itemStatus({ id: 'a', side: 'tenant', update: { id: 'u', status: 'confirmed', stage: 'blocked' } }), 'complete');
  assert.equal(itemStatus({ id: 'a', side: 'tenant', update: { id: 'u', status: 'in_progress' } }), 'progress');
  assert.equal(itemStatus({ id: 'a', side: 'tenant', update: { id: 'u', status: 'pending' } }), 'pending');
  assert.equal(itemStatus({ id: 'a', side: 'tenant', update: { id: 'u', status: 'in_progress', stage: 'waiting_client' } }), 'waiting');
  assert.equal(itemStatus({ id: 'a', side: 'tenant', update: { id: 'u', status: 'in_progress', stage: 'needs_input' } }), 'input');
  assert.equal(itemStatus({ id: 'a', side: 'tenant', update: { id: 'u', status: 'pending', stage: 'blocked' } }), 'blocked');
  assert.equal(itemStatus({ id: 'a', side: 'tenant' }), 'pending', 'an untracked client message is pending');
  assert.equal(itemStatus({ id: 'a', side: 'tenant' }, { stage: 'waiting_client', reason: 'x' }), 'waiting', 'the local task list stage counts');
  assert.equal(itemStatus({ id: 'a', side: 'platform' }), null, 'a plain developer message is not an update');
  assert.equal(itemStatus({ id: 'a', side: 'tenant', event: { action: 'start' } }), null);
  assert.equal(itemStatus({ id: 'a', side: 'tenant', deleted: true }), null);
  assert.equal(itemStatus({ id: 'a', side: 'tenant', pending: true }), null);
});

test('updates list one row per task, newest first, with the reason and whether the client must answer', () => {
  const messages = [
    { id: 'm1', side: 'tenant', text: 'Amazon label missing', createdAt: at(1), update: { id: 'u1', status: 'in_progress', stage: 'waiting_client', reason: 'Easy Ship or Self Ship?', title: 'Amazon label' } },
    { id: 'm2', side: 'tenant', text: 'more detail', createdAt: at(2), update: { id: 'u1', status: 'in_progress', stage: 'waiting_client' } },
    { id: 'm3', side: 'platform', text: 'ok', createdAt: at(3) },
    { id: 'm4', side: 'tenant', text: 'Filters please', createdAt: at(4), update: { id: 'u2', status: 'done', issue: 'no filter', fix: 'filter added' } },
    { id: 'm5', side: 'tenant', text: 'Sales wrong', createdAt: at(5) },
  ];
  const items = updateItems(messages, { m5: { stage: 'needs_input', reason: 'Which period?' } });
  assert.deepEqual(items.map((i) => i.id), ['m5', 'm4', 'm1']);
  const label = items.find((i) => i.id === 'm1');
  assert.equal(label.title, 'Amazon label');
  assert.equal(label.reason, 'Easy Ship or Self Ship?');
  assert.equal(label.needsClient, true);
  assert.equal(label.replies, 1);
  assert.equal(label.label, 'Waiting for client');
  const sales = items.find((i) => i.id === 'm5');
  assert.equal(sales.status, 'input');
  assert.equal(sales.reason, 'Which period?');
  assert.equal(sales.needsClient, true);
  const filters = items.find((i) => i.id === 'm4');
  assert.equal(filters.needsClient, false);
  assert.deepEqual(filters.summary, { issue: 'no filter', fix: 'filter added' });

  assert.deepEqual(countItems(items), { all: 3, pending: 0, progress: 0, waiting: 1, input: 1, blocked: 0, complete: 1 });
  assert.deepEqual(filterItems(items, 'complete').map((i) => i.id), ['m4']);
  assert.deepEqual(filterItems(items, 'all').map((i) => i.id), ['m5', 'm4', 'm1']);
});

test('history combines every status change and every message sent about the updates, newest first', () => {
  const messages = [
    { id: 'm1', side: 'tenant', text: 'Amazon label missing', createdAt: at(1), update: { id: 'u1', status: 'done' } },
    { id: 'e1', side: 'platform', senderName: 'OMSKing Platform', createdAt: at(2), event: { action: 'start', title: 'Amazon label' }, update: { id: 'u1', status: 'done' } },
    { id: 'm2', side: 'platform', senderName: 'OMSKing Platform', text: 'Easy Ship or Self Ship?', createdAt: at(3), replyTo: { id: 'm1', text: 'Amazon label missing' } },
    { id: 'm3', side: 'tenant', senderName: 'Leheriya', text: 'Easy Ship', createdAt: at(4), replyTo: { id: 'm2', text: 'Easy Ship or Self Ship?' } },
    { id: 'e2', side: 'platform', senderName: 'OMSKing Platform', createdAt: at(5), event: { action: 'complete', title: 'Amazon label' } },
    { id: 'gone', side: 'platform', deleted: true, createdAt: at(6) },
  ];
  const entries = historyEntries(messages);
  assert.deepEqual(entries.map((e) => e.id), ['e2', 'm3', 'm2', 'e1']);
  assert.equal(entries[0].kind, 'status');
  assert.match(entries[0].text, /marked "Amazon label" as fixed/);
  assert.equal(entries[1].kind, 'message');
  assert.equal(entries[1].about, 'Easy Ship or Self Ship?');
  assert.equal(entries[2].who, 'OMSKing Platform');
  assert.equal(entries[3].target, 'm1', 'a status change opens the task message (status labels are hidden in the chat)');
  assert.equal(entries[1].target, 'm3');
});

test('the report window shows the tabs, a card/table switch, status chips and an answer box for client items', () => {
  const view = fs.readFileSync(new URL('../components/report/ReportUpdatesView.jsx', import.meta.url), 'utf8');
  assert.match(view, /aria-label="Cards view"/);
  assert.match(view, /aria-label="Table view"/);
  assert.match(view, /ITEM_STATUSES\.map/);
  assert.match(view, /aria-label=\{`Client answer for/);
  assert.match(view, /historyEntries\(/);
  const pane = fs.readFileSync(new URL('../components/report/ChatPane.jsx', import.meta.url), 'utf8');
  assert.match(pane, /REPORT_TABS\.map/);
  assert.match(pane, /role="tab"/);
  assert.match(pane, /<ReportUpdatesView/);
  assert.match(pane, /tab !== 'chat' && 'hidden'/, 'the chat stays mounted (scroll, drafts, recording) while another tab is open');
  assert.match(pane, /onAnswer=\{\(m, body\) => sendOne\(\{ body, reply: quoteOf\(m\) \}\)\}/);
  assert.match(pane, /open=\{openStatus\(m, reasons\[m\.id\]\)\}/, 'the reason panel and reply box on each message stay');
});
