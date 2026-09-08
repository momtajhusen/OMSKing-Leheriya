// Renders every page component once through react-dom/server to catch runtime
// errors (bad field access, undefined.map) that a build/transform check misses.
// Run: node scripts/render-check.mjs
import { createServer } from 'vite';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});

// useLayoutEffect warnings are inherent to server rendering and say nothing
// about whether the page is broken, so keep them out of the report.
const realError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
  realError(...args);
};

const pageDirs = ['pages/admin', 'pages/vendor', 'pages/auth', 'pages/public', 'pages/platform'];
const pages = pageDirs.flatMap((dir) =>
  readdirSync(path.join(root, 'src', dir))
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => `/src/${dir}/${f}`)
);
pages.push('/src/pages/NotFoundPage.jsx');

const vite = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

let failed = 0;
for (const page of pages) {
  try {
    const mod = await vite.ssrLoadModule(page);
    if (typeof mod.default !== 'function') throw new Error('no default export component');
    renderToString(
      React.createElement(MemoryRouter, null, React.createElement(mod.default))
    );
    console.log('ok    ', page);
  } catch (err) {
    failed += 1;
    console.log('FAIL  ', page);
    console.log('       ', err.message.split('\n')[0]);
  }
}

await vite.close();
console.log(`\n${pages.length - failed}/${pages.length} pages rendered, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
