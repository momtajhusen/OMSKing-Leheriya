import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollPageToTop } from './scrollPageToTop.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('scrollPageToTop resets the window, #root and every <main> scroll container', () => {
  const root = { scrollTop: 900 };
  const mains = [{ scrollTop: 1200 }, { scrollTop: 40 }];
  const calls = [];
  globalThis.window = { scrollTo: (x, y) => calls.push([x, y]) };
  globalThis.document = {
    getElementById: (id) => (id === 'root' ? root : null),
    querySelectorAll: (selector) => (selector === 'main' ? mains : []),
  };
  try {
    scrollPageToTop();
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
  assert.deepEqual(calls, [[0, 0]]);
  assert.equal(root.scrollTop, 0);
  assert.deepEqual(mains.map((el) => el.scrollTop), [0, 0]);
});

test('every layout scrolls to the top when the page path changes', () => {
  for (const name of ['PublicLayout', 'AdminLayout', 'PlatformLayout', 'VendorLayout']) {
    const source = read(`../components/layout/${name}.jsx`);
    assert.match(source, /scrollPageToTop|useScrollTopOnNavigate\(\)/, `${name} resets scroll on navigation`);
  }
  const publicLayout = read('../components/layout/PublicLayout.jsx');
  assert.doesNotMatch(publicLayout, /window\.scrollTo\(0, 0\)/, 'public layout no longer relies on window scroll alone');
  const hook = read('../hooks/useScrollTopOnNavigate.js');
  assert.match(hook, /\[pathname\]/, 'only a path change resets scroll, not filters in the query string');
});
