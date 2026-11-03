process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { createSupportLiveProxy, LOOP_HEADER } = require('../src/services/supportLiveProxy');

const PASSWORD = 'live-secret-pw';

function fakeJwt(expSec) {
  const part = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ sub: 'dev', exp: expSec })}.sig`;
}

/** Stands in for the live API: records every request, answers like the real routes. */
function startFakeLive({ expiresInSec = 900, rejectFirstToken = false } = {}) {
  const seen = [];
  let logins = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const json = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.url === '/api/v1/auth/login') {
        const { email, password } = JSON.parse(body.toString() || '{}');
        if (email !== 'dev@live.test' || password !== PASSWORD) return json(401, { success: false, message: 'Invalid credentials' });
        logins += 1;
        return json(200, { success: true, data: { accessToken: `${fakeJwt(Math.floor(Date.now() / 1000) + expiresInSec)}${logins}` } });
      }
      if (req.url.startsWith('/api/v1/support/media/')) {
        res.writeHead(206, { 'content-type': 'video/webm', 'content-range': 'bytes 0-3/10', 'x-internal': 'nope' });
        return res.end(Buffer.from([1, 2, 3, 4]));
      }
      if (rejectFirstToken && req.headers.authorization?.endsWith('1')) return json(401, { success: false, message: 'Session expired' });
      return json(200, { success: true, data: { path: req.url, auth: Boolean(req.headers.authorization) } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, seen, logins: () => logins, url: `http://127.0.0.1:${server.address().port}/api/v1`,
  })));
}

function startLocal(settings, guard = []) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/support', createSupportLiveProxy(settings, guard));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/api/v1/support` }));
  });
}

async function withServers(fakeOpts, settingsFor, run, guard) {
  const live = await startFakeLive(fakeOpts);
  const local = await startLocal(settingsFor(live), guard);
  try {
    await run(live, local);
  } finally {
    live.server.closeAllConnections(); live.server.close();
    local.server.closeAllConnections(); local.server.close();
  }
}

const creds = (live) => ({ url: live.url, email: 'dev@live.test', password: PASSWORD });

test('developer support requests on localhost go to the live API with the live developer login', async () => {
  await withServers({}, creds, async (live, local) => {
    const res = await fetch(`${local.url}/threads?limit=5`, { headers: { authorization: 'Bearer local-token' } });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { path: '/api/v1/support/threads?limit=5', auth: true });
    const forwarded = live.seen.find((r) => r.url.startsWith('/api/v1/support/threads'));
    assert.ok(forwarded.headers.authorization.startsWith('Bearer '), 'the live token is sent');
    assert.notEqual(forwarded.headers.authorization, 'Bearer local-token', 'the localhost token never reaches live');
    assert.equal(forwarded.headers[LOOP_HEADER], '1');

    await fetch(`${local.url}/all-updates`);
    assert.equal(live.logins(), 1, 'the live login is reused while it is valid');
  });
});

test('status marks and messages are forwarded intact: JSON bodies and streamed uploads', async () => {
  await withServers({}, creds, async (live, local) => {
    const patch = await fetch(`${local.url}/threads/t1/updates/u1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'complete' }),
    });
    assert.equal(patch.status, 200);
    const sentPatch = live.seen.find((r) => r.method === 'PATCH');
    assert.equal(sentPatch.url, '/api/v1/support/threads/t1/updates/u1');
    assert.deepEqual(JSON.parse(sentPatch.body.toString()), { action: 'complete' });

    const form = new FormData();
    form.append('text', 'clip attached');
    form.append('files', new Blob([Buffer.from('VIDEO-BYTES')], { type: 'video/webm' }), 'screen.webm');
    const post = await fetch(`${local.url}/threads/t1/messages`, { method: 'POST', body: form });
    assert.equal(post.status, 200);
    const sentPost = live.seen.find((r) => r.method === 'POST' && r.url.endsWith('/messages'));
    assert.match(sentPost.headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.ok(sentPost.body.includes('VIDEO-BYTES') && sentPost.body.includes('clip attached'), 'the upload arrives byte for byte');
  });
});

test('media links stream from live without a login, keeping range headers', async () => {
  await withServers({}, creds, async (live, local) => {
    const res = await fetch(`${local.url}/media/abc?exp=1&sig=ff`, { headers: { range: 'bytes=0-3' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-type'), 'video/webm');
    assert.equal(res.headers.get('content-range'), 'bytes 0-3/10');
    assert.equal(res.headers.get('x-internal'), null, 'only media headers are passed back');
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3, 4]);
    const sent = live.seen.find((r) => r.url.startsWith('/api/v1/support/media/'));
    assert.equal(sent.url, '/api/v1/support/media/abc?exp=1&sig=ff');
    assert.equal(sent.headers.range, 'bytes=0-3');
    assert.equal(sent.headers.authorization, undefined);
    assert.equal(live.logins(), 0);
  });
});

test('an expired live login is renewed once and the request retried', async () => {
  await withServers({ rejectFirstToken: true }, creds, async (live, local) => {
    const res = await fetch(`${local.url}/threads`);
    assert.equal(res.status, 200);
    assert.equal(live.logins(), 2);
  });
});

test('a live login that is about to expire is renewed before the request', async () => {
  await withServers({ expiresInSec: 30 }, creds, async (live, local) => {
    await fetch(`${local.url}/threads`);
    await fetch(`${local.url}/threads`);
    assert.equal(live.logins(), 2);
  });
});

test('client (merchant) routes are not sent to live from localhost', async () => {
  await withServers({}, creds, async (live, local) => {
    for (const [method, path] of [['GET', '/messages'], ['POST', '/messages'], ['GET', '/unread'], ['POST', '/read'], ['PATCH', '/updates/u1']]) {
      const res = await fetch(`${local.url}${path}`, { method });
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.match((await res.json()).message, /live site/);
    }
    assert.equal(live.seen.length, 0);
  });
});

test('missing or wrong live credentials give a clear error that never echoes the password', async () => {
  await withServers({}, (live) => ({ url: live.url, email: '', password: '' }), async (live, local) => {
    const res = await fetch(`${local.url}/threads`);
    assert.equal(res.status, 503);
    assert.match((await res.json()).message, /SUPPORT_LIVE_EMAIL/);
    assert.equal(live.seen.length, 0);
  });
  await withServers({}, (live) => ({ ...creds(live), password: 'wrong-pw' }), async (live, local) => {
    const res = await fetch(`${local.url}/threads`);
    assert.equal(res.status, 502, 'a live auth failure must not look like a local 401 (that would log the developer out)');
    const text = await res.text();
    assert.match(text, /live/i);
    assert.ok(!text.includes('wrong-pw') && !text.includes(PASSWORD));
  });
});

test('a forwarded request is never forwarded again (proxy loop)', async () => {
  await withServers({}, creds, async (live, local) => {
    const res = await fetch(`${local.url}/threads`, { headers: { [LOOP_HEADER]: '1' } });
    assert.equal(res.status, 508);
    assert.equal(live.seen.length, 0);
  });
});

test('the live API being unreachable gives a 502', async () => {
  const local = await startLocal({ url: 'http://127.0.0.1:9/api/v1', email: 'dev@live.test', password: PASSWORD });
  try {
    const res = await fetch(`${local.url}/threads`);
    assert.equal(res.status, 502);
  } finally {
    local.server.closeAllConnections(); local.server.close();
  }
});

test('the local guard (local platform login) runs before anything is forwarded', async () => {
  const deny = (req, res) => res.status(401).json({ success: false, message: 'Authentication required' });
  await withServers({}, creds, async (live, local) => {
    const res = await fetch(`${local.url}/threads`);
    assert.equal(res.status, 401);
    assert.equal(live.seen.length, 0);
    const media = await fetch(`${local.url}/media/abc?exp=1&sig=ff`);
    assert.equal(media.status, 206, 'signed media links need no login');
  }, [deny]);
});

test('/support uses the live proxy only in development; the live server keeps its own routes', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/routes/v1/index.js'), 'utf8');
  assert.match(src, /config\.nodeEnv === 'development' \? supportLive : supportRoutes/);
  const config = require('../src/config');
  assert.equal(config.supportLive.url, process.env.SUPPORT_LIVE_API_URL || 'https://omskingapi.codersalpha.com/api/v1');
});
