import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inputDraft, nearbyText } from './autofixInputs.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const request = {
  messageId: 'a1',
  message: 'Courier change karo',
  unclear: 'Which courier?',
  options: ['Delhivery', 'Shree Maruti'],
  from: 'client',
  nearby: {
    before: [{ messageId: 'a0', message: 'Pickup late hai', status: 'Complete' }],
    after: [{ messageId: 'a2', message: 'Manifest bhi', status: 'Not started' }],
  },
};

test('the form starts from what Auto-fix already knows', () => {
  assert.equal(inputDraft(request, 'developer'), 'About "Courier change karo": Which courier?\nDecision: ');
  assert.equal(inputDraft(request, 'developer', 'Delhivery'), 'About "Courier change karo": Which courier?\nDecision: Delhivery');
  assert.equal(inputDraft(request, 'client'), 'Which courier? (Delhivery or Shree Maruti)');
  assert.equal(inputDraft({ ...request, options: [] }, 'client'), 'Which courier?');
});

test('the nearby messages Auto-fix read are shown with the form', () => {
  assert.equal(nearbyText(request.nearby), 'Before: "Pickup late hai" (Complete)\nAfter: "Manifest bhi" (Not started)');
  assert.equal(nearbyText({ before: [], after: [] }), '');
  assert.equal(nearbyText(undefined), '');
});

test('tasks needing input use the collapse form and post the answer', () => {
  const button = read('../components/report/AutoFixButton.jsx');
  assert.match(button, /<details/);
  assert.match(button, /\/dev\/report-autofix\/inputs/);
  assert.match(button, /inputDraft\(/);
});
