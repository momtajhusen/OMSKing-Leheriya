import test from 'node:test';
import assert from 'node:assert/strict';
import { isChunkLoadError } from './lazyWithReload.js';

test('detects Vite dynamic import miss after a deploy', () => {
  assert.equal(
    isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://omsking.codersalpha.com/assets/FulfilmentPage-UFT062xT.js')),
    true,
  );
  assert.equal(isChunkLoadError(new Error('Network Error')), false);
});
