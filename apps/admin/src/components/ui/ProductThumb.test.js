import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const thumb = fs.readFileSync(new URL('./ProductThumb.jsx', import.meta.url), 'utf8');

test('a photo that does not load falls back to the letter tile instead of a broken image', () => {
  assert.match(thumb, /onError=\{\(\) => setBroken\(resolved\)\}/);
  assert.match(thumb, /const photo = resolved && broken !== resolved \? resolved : ''/);
});
