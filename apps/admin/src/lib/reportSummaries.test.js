import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSummary, summaryHint } from './reportUpdates.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('the Hinglish issue / fix lines are one shared helper', () => {
  assert.equal(summaryHint({ issue: 'Page atak jaata tha', fix: 'API halki ki' }), 'Issue kya tha: Page atak jaata tha\nFix kya kiya: API halki ki');
  assert.equal(summaryHint({ issue: 'Page atak jaata tha', fix: '' }), 'Issue kya tha: Page atak jaata tha');
  assert.equal(summaryHint(null), '');
});

test('the summary saved on the live update wins over the local task list one', () => {
  const local = { issue: 'local issue', fix: 'local fix' };
  assert.deepEqual(pickSummary({ status: 'done', issue: 'live issue', fix: 'live fix' }, local), { issue: 'live issue', fix: 'live fix' });
  assert.equal(pickSummary({ status: 'done', issue: '', fix: '' }, local), local);
  assert.equal(pickSummary(null, undefined), undefined);
});

test('the Hinglish hover stays in the Report chat; the side list has no detail icon', () => {
  const sidebar = read('../components/layout/AdminSidebar.jsx');
  assert.doesNotMatch(sidebar, /ModuleDetailIcon|Summaries|moduleHint|Issue kya tha/);
});
