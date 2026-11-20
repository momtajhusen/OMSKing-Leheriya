import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saveOrdersListScroll,
  peekOrdersListScroll,
  clearOrdersListScroll,
  writeMainScrollTop,
  readMainScrollTop,
} from './listScroll.js';

test('orders list scroll is saved and cleared from sessionStorage', () => {
  const main = { scrollTop: 640 };
  const store = new Map();
  globalThis.document = { querySelector: (sel) => (sel === 'main' ? main : null) };
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  try {
    assert.equal(readMainScrollTop(), 640);
    saveOrdersListScroll();
    assert.equal(peekOrdersListScroll(), 640);
    writeMainScrollTop(0);
    assert.equal(main.scrollTop, 0);
    writeMainScrollTop(peekOrdersListScroll());
    assert.equal(main.scrollTop, 640);
    clearOrdersListScroll();
    assert.equal(peekOrdersListScroll(), null);
  } finally {
    delete globalThis.document;
    delete globalThis.sessionStorage;
  }
});
