import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { serverRestarting, sessionRejected } from './authErrors.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('only a real 401 / 403 from the server ends the session', () => {
  assert.equal(sessionRejected({ response: { status: 401 } }), true);
  assert.equal(sessionRejected({ response: { status: 403 } }), true);
  assert.equal(sessionRejected({ response: { status: 500 } }), false, 'dev proxy error while the backend restarts');
  assert.equal(sessionRejected({ response: { status: 502 } }), false);
  assert.equal(sessionRejected({ code: 'ERR_NETWORK' }), false, 'backend unreachable');
  assert.equal(sessionRejected(undefined), false);
});

test('page load and token refresh keep the login when the backend is only unreachable', () => {
  assert.match(read('../stores/authStore.js'), /sessionRejected\(/);
  assert.match(read('./api.js'), /sessionRejected\(/);
});

test('a raw 500 / no answer while the backend restarts is told apart from a real error message', () => {
  assert.equal(serverRestarting({ code: 'ERR_NETWORK' }), true);
  assert.equal(serverRestarting({ response: { status: 500, data: '' } }), true, 'dev proxy: backend not reachable');
  assert.equal(serverRestarting({ response: { status: 504, data: {} } }), true);
  assert.equal(serverRestarting({ response: { status: 502, data: { success: false, message: 'Tasks could not be marked' } } }), false, 'our own error keeps its message');
  assert.equal(serverRestarting({ response: { status: 409, data: { success: false } } }), false);
});

test('Apply fix waits for the server and re-checks instead of showing the raw 500', () => {
  const button = read('../components/report/AutoFixButton.jsx');
  assert.match(button, /serverRestarting\(err\)/);
  assert.match(button, /waitForServer\(/);
});
