import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inputGuide } from './inputGuide.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const DEVANAGARI = /[\u0900-\u097F]/;

test('the main message above the box is Hinglish: a title and what is needed, for every kind of question', () => {
  assert.equal(inputGuide({ kind: 'unclear', unclear: 'x' }).title, 'Ek decision chahiye');
  assert.equal(inputGuide({ kind: 'waiting', unclear: 'x' }).title, 'Client se ye jaankari chahiye');
  assert.equal(inputGuide({ kind: 'unclear', during: 'testing', unclear: 'x' }).title, 'Test ya check ke liye kuch chahiye');
  assert.equal(inputGuide({ kind: 'unclear', unclear: 'x' }).needLabel, 'Kya chahiye');
  assert.equal(inputGuide({ kind: 'unclear', unclear: 'Which courier?', needHi: 'Kaunsa courier use karna hai?' }).need, 'Kaunsa courier use karna hai?');
  assert.equal(inputGuide({ kind: 'unclear', unclear: 'Which courier?' }).need, 'Which courier?', 'an old task without a Hinglish line shows its own text');
});

test('every label is Hinglish (English letters, no Devanagari), with no language switch and no step list', () => {
  const guide = inputGuide({ kind: 'unclear', unclear: 'x' });
  Object.entries(guide).forEach(([key, value]) => {
    if (typeof value === 'string') assert.doesNotMatch(value, DEVANAGARI, key);
  });
  for (const gone of ['toggle', 'yes', 'no', 'steps', 'secret']) assert.equal(guide[gone], undefined, gone);
  assert.equal(guide.submit, 'Submit karein');
  assert.equal(guide.placeholder, 'Jawab yahan likhein');
});

test('every input form shows the message above its box, without a language switch or steps, and starts Auto-fix after a submit', () => {
  const block = read('../components/report/InputGuide.jsx');
  assert.match(block, /role="note"/);
  assert.doesNotMatch(block, /aria-pressed|guide\.steps|guide\.secret|useGuideLang/);

  const forms = {
    header: read('../components/report/AutoFixButton.jsx'),
    paste: read('../components/report/AutofixScopeModal.jsx'),
    updates: read('../components/report/ReportUpdatesView.jsx'),
  };
  for (const [name, src] of Object.entries(forms)) {
    const guideAt = src.indexOf('<InputGuide');
    const boxAt = src.indexOf('<textarea', guideAt);
    assert.ok(guideAt > 0 && boxAt > guideAt, `${name}: the message is above the input box`);
    assert.doesNotMatch(src, /useGuideLang|onLang=/, `${name}: no language switch`);
    assert.match(src, /api\.post\('\/dev\/report-autofix', \{ messageId/, `${name}: Auto-fix starts after the submit`);
  }
});
