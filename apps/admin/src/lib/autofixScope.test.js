import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedFor, canScopeFix, missingInput, pasteGuide, SCOPE_LABEL, startedMessage } from './autofixScope.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const waiting = { messageId: 'a1', message: 'Shree Maruti chahiye', kind: 'waiting', unclear: 'Shree Maruti API docs', options: [] };
const unclear = { messageId: 'a2', message: 'Tab hatao', kind: 'unclear', unclear: 'Which tab should be removed?', options: ['Unfulfillable', 'On hold'] };

test('only In progress style filters stop for missing input; Complete has nothing to fix', () => {
  assert.deepEqual(blockedFor('progress', [waiting, unclear]), [waiting, unclear]);
  assert.deepEqual(blockedFor('developer', [waiting]), [waiting]);
  assert.deepEqual(blockedFor('all', [waiting]), [waiting]);
  assert.deepEqual(blockedFor('pending', [waiting]), [], 'pending tasks never wait for input');
  assert.equal(canScopeFix('fixed'), false);
  assert.equal(canScopeFix('pending'), true);
  assert.equal(SCOPE_LABEL.progress, 'In progress');
});

test('the modal says in English what to paste, and refuses to clear without it', () => {
  assert.match(pasteGuide(waiting), /Paste .*Shree Maruti API docs/);
  assert.match(pasteGuide(unclear), /Which tab should be removed\?/);
  assert.equal(missingInput(waiting, 'https://docs.example.test'), null);
  assert.equal(missingInput(waiting, '   '), 'Not provided: Shree Maruti API docs. This message cannot be cleared without it.');
  assert.equal(missingInput({ ...waiting, unclear: '' }, ''), 'Not provided: the required input. This message cannot be cleared without it.');
});

test('filter chips and In progress messages get an Auto-fix icon that opens the paste modal', () => {
  const pane = read('../components/report/ChatPane.jsx');
  assert.match(pane, /aria-label=\{`Auto-fix \$\{f\.label\} messages`\}/);
  assert.match(pane, /AutofixScopeModal/);
  assert.match(pane, /onAutofix=/);
  const bubble = read('../components/report/MessageBubble.jsx');
  assert.match(bubble, /in_progress/);
  assert.match(bubble, /Auto-fix this message/);
  const modal = read('../components/report/AutofixScopeModal.jsx');
  assert.match(modal, />Clear</);
  assert.match(modal, /<textarea/);
  assert.match(modal, /missingInput\(/);
  assert.match(modal, /Do not paste passwords or API keys/);
});

test('after a chip or message Auto-fix starts, the chat scrolls to the message it is fixing', () => {
  assert.equal(startedMessage({ next: { messageId: 'b2' } }, { scope: 'progress' }), 'b2');
  assert.equal(startedMessage({}, { messageId: 'c3' }), 'c3', 'a message Auto-fix scrolls to that message');
  assert.equal(startedMessage(null, { scope: 'all' }), null);
  assert.match(read('../components/report/ChatPane.jsx'), /const id = startedMessage\(data\.data, body\);\n\s*if \(id\) setFocus\(\{ id \}\);/);
  assert.match(read('../components/report/AutofixScopeModal.jsx'), /onStarted\?\.\(item\.messageId\)/);
});

test('the chip auto-fix button is only on Pending and In progress', () => {
  assert.equal(canScopeFix('pending'), true);
  assert.equal(canScopeFix('progress'), true);
  for (const scope of ['all', 'fixed', 'developer', 'client']) assert.equal(canScopeFix(scope), false, scope);
});
