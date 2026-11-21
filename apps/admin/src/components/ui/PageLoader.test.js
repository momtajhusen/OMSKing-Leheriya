import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const loader = fs.readFileSync(new URL('./PageLoader.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

test('in-page loader is a compact component panel, not a full-page skeleton', () => {
  assert.doesNotMatch(loader, /min-h-\[calc\(100dvh/);
  assert.doesNotMatch(loader, /page-loader-bone/);
  assert.doesNotMatch(loader, /page-loader-mark/);
  assert.match(loader, /page-loader-shell/);
  assert.match(loader, /page-loader-line/);
  assert.match(loader, /page-loader-dot/);
  assert.match(loader, /min-h-\[9\.5rem\]/);
  assert.match(loader, /fullscreen/);
});

test('loader motion stays short and respects reduced motion', () => {
  assert.match(css, /page-loader-line-run/);
  assert.match(css, /page-loader-shell-in/);
  assert.match(css, /prefers-reduced-motion[\s\S]*page-loader-line/);
});
