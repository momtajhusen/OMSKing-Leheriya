import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { autofixTarget, focusReportMessage, onReportFocus } from './reportFocus.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('asking to focus a message reaches the Report listener, once per call, until it stops listening', () => {
  const target = new EventTarget();
  const seen = [];
  const stop = onReportFocus((id) => seen.push(id), target);
  focusReportMessage('m1', target);
  focusReportMessage('', target);
  stop();
  focusReportMessage('m2', target);
  assert.deepEqual(seen, ['m1']);
});

test('Auto-fix opens the Report chat and scrolls to the message it is fixing', () => {
  assert.match(read('../components/report/AutoFixButton.jsx'), /focusReportMessage\(/);
  assert.match(read('../components/report/ReportButton.jsx'), /onReportFocus\(/);
  const pane = read('../components/report/ChatPane.jsx');
  assert.match(pane, /focusId/);
  assert.match(pane, /jumpTo\(focus\.id\)/);
});

test('the chat icon goes to the task Auto-fix is fixing now, else the one it fixes next', () => {
  assert.equal(autofixTarget({ run: { running: true, messageId: 'a' }, next: { messageId: 'b' } }), 'a');
  assert.equal(autofixTarget({ run: { running: false, messageId: 'a' }, next: { messageId: 'b' } }), 'b');
  assert.equal(autofixTarget({ run: null, next: null }), null);
  const pane = read('../components/report/ChatPane.jsx');
  assert.match(pane, /autofixTarget\(/);
  assert.match(pane, /Scroll to the message Auto-fix/);
});
