import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowHead, drawShape, isMeaningful, markedName, MARKUP_COLORS, MARKUP_TOOLS, strokeWidth, toImagePoint } from './screenshotMarkup.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

function fakeCtx() {
  const calls = [];
  const ctx = {};
  ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'strokeRect'].forEach((name) => {
    ctx[name] = (...args) => calls.push([name, ...args]);
  });
  return { ctx, calls, names: () => calls.map((c) => c[0]) };
}

test('pointer positions map from the scaled preview to real screenshot pixels', () => {
  const rect = { left: 100, top: 50, width: 500, height: 250 };
  assert.deepEqual(toImagePoint(350, 175, rect, 2000, 1000), { x: 1000, y: 500 });
  assert.deepEqual(toImagePoint(0, 9999, rect, 2000, 1000), { x: 0, y: 1000 }, 'kept inside the picture');
});

test('lines stay visible on big screenshots', () => {
  assert.equal(strokeWidth(600), 3);
  assert.equal(strokeWidth(3000), 10);
});

test('draw, box and arrow paint with the chosen colour', () => {
  const pen = fakeCtx();
  drawShape(pen.ctx, { tool: 'pen', color: '#ef4444', width: 4, points: [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 9, y: 2 }] });
  assert.equal(pen.ctx.strokeStyle, '#ef4444');
  assert.equal(pen.ctx.lineWidth, 4);
  assert.deepEqual(pen.names(), ['save', 'beginPath', 'moveTo', 'lineTo', 'lineTo', 'stroke', 'restore']);

  const box = fakeCtx();
  drawShape(box.ctx, { tool: 'box', color: '#3b82f6', width: 4, from: { x: 50, y: 40 }, to: { x: 10, y: 0 } });
  assert.deepEqual(box.calls.find((c) => c[0] === 'strokeRect'), ['strokeRect', 10, 0, 40, 40], 'dragging up-left still draws the box');

  const arrow = fakeCtx();
  drawShape(arrow.ctx, { tool: 'arrow', color: '#22c55e', width: 4, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
  assert.equal(arrow.names().filter((n) => n === 'moveTo').length, 3, 'shaft plus two head strokes');
  const [left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
  assert.ok(left.x < 100 && right.x < 100 && left.y < 0 && right.y > 0, 'head points back along the shaft');
});

test('a click without a drag does not leave an empty box or arrow', () => {
  assert.equal(isMeaningful({ tool: 'box', from: { x: 5, y: 5 }, to: { x: 6, y: 6 } }), false);
  assert.equal(isMeaningful({ tool: 'arrow', from: { x: 5, y: 5 }, to: { x: 60, y: 6 } }), true);
  assert.equal(isMeaningful({ tool: 'pen', points: [{ x: 1, y: 1 }] }), true, 'a dot is fine');
  assert.equal(markedName('screenshot-17.png'), 'screenshot-17-marked.png');
  assert.equal(markedName(''), 'screenshot-marked.png');
  assert.ok(MARKUP_COLORS.length >= 4);
  assert.deepEqual(MARKUP_TOOLS.map((t) => t.label), ['Draw', 'Box', 'Arrow']);
});

test('the markup editor opens inside the report with a message box and Send', () => {
  const editor = read('../components/report/ScreenshotEditor.jsx');
  const chat = read('../components/report/ChatPane.jsx');
  assert.match(editor, /aria-label="Undo"/);
  assert.match(editor, /aria-label="Send screenshot"/);
  assert.match(editor, /placeholder="Add a message…"/);
  assert.match(editor, /toBlob\(/);
  assert.match(editor, /drawShape\(/);
  assert.match(chat, /<ScreenshotEditor/);
  assert.match(chat, /aria-label="Mark up"/, 'any staged photo can be marked up');
  assert.match(chat, /send\(\{ text: caption, staged: items \}\)/, 'sends through the normal chat send');
});

test('the markup editor opens full screen above the report so the screenshot is big enough to mark', () => {
  const editor = read('../components/report/ScreenshotEditor.jsx');
  assert.match(editor, /createPortal\(/, 'not boxed inside the narrow chat pane');
  assert.match(editor, /fixed inset-0 z-\[90\]/, 'above the report dialog (z-80)');
  assert.doesNotMatch(editor, /absolute inset-0 z-40/);
});
