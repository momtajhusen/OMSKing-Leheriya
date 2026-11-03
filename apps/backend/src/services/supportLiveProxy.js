const http = require('http');
const https = require('https');
const express = require('express');

const LOOP_HEADER = 'x-omsking-support-proxy';
const DEVELOPER_PATH = /^\/(threads|all-updates)(\/|\?|$)/;
const REQUEST_HEADERS = ['content-type', 'content-length', 'accept', 'range'];
const RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified', 'content-disposition'];
const RENEW_BEFORE_MS = 60 * 1000;

class ProxyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message, data: null });
}

function upstreamRequest(url, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(target, { method, headers: { ...headers, [LOOP_HEADER]: '1' } }, resolve);
    req.on('error', reject);
    if (body && typeof body.pipe === 'function') body.pipe(req);
    else req.end(body);
  });
}

function readJson(res) {
  return new Promise((resolve) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); }
    });
    res.on('error', () => resolve(null));
  });
}

function tokenExpiry(token) {
  try {
    const { exp } = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
    return Number(exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

/** Body to send upstream: parsed JSON/form bodies are re-encoded; anything else (multipart uploads) is streamed. */
function outgoingBody(req) {
  if (req._body) {
    const json = Buffer.from(JSON.stringify(req.body ?? {}));
    return { body: json, headers: { 'content-type': 'application/json', 'content-length': String(json.length) }, replayable: true };
  }
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || Boolean(req.headers['transfer-encoding']);
  if (!hasBody) return { body: null, headers: {}, replayable: true };
  return { body: req, headers: {}, replayable: false };
}

/**
 * Developer Support on a localhost backend: every developer request is sent to the live API (live MongoDB), signed in
 * as the live developer account from `settings` (read per request: { url, email, password }). Nothing is stored locally.
 * `guard` is the local login check for non-media routes. Client (merchant) routes are refused: localhost acts as the
 * developer only, so it never posts into a client's thread as that client.
 */
function createSupportLiveProxy(settings, guard = []) {
  let session = null;
  let signingIn = null;

  async function signIn() {
    const { url, email, password } = settings;
    if (!email || !password) {
      throw new ProxyError(503, 'Live Developer Support is not set up: add SUPPORT_LIVE_EMAIL and SUPPORT_LIVE_PASSWORD to apps/backend/.env');
    }
    const payload = Buffer.from(JSON.stringify({ email, password }));
    let res;
    try {
      res = await upstreamRequest(`${url}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
        body: payload,
      });
    } catch {
      throw new ProxyError(502, 'Cannot reach the live Developer Support API');
    }
    const data = await readJson(res);
    const token = data?.data?.accessToken;
    if (res.statusCode !== 200 || !token) {
      throw new ProxyError(502, `The live Developer Support API refused the developer login (HTTP ${res.statusCode})`);
    }
    return { token, expiresAt: tokenExpiry(token) };
  }

  async function liveToken(renew) {
    if (!renew && session && session.expiresAt - RENEW_BEFORE_MS > Date.now()) return session.token;
    if (!signingIn) signingIn = signIn().finally(() => { signingIn = null; });
    session = await signingIn;
    return session.token;
  }

  async function send(req, withLogin) {
    const { body, headers: bodyHeaders, replayable } = outgoingBody(req);
    const headers = {};
    REQUEST_HEADERS.forEach((name) => { if (req.headers[name]) headers[name] = req.headers[name]; });
    Object.assign(headers, bodyHeaders);
    const url = `${settings.url}/support${req.url}`;
    const attempt = async (renew) => {
      if (withLogin) headers.authorization = `Bearer ${await liveToken(renew)}`;
      try {
        return await upstreamRequest(url, { method: req.method, headers, body });
      } catch {
        throw new ProxyError(502, 'Cannot reach the live Developer Support API');
      }
    };
    let upstream = await attempt(false);
    if (withLogin && upstream.statusCode === 401 && replayable) {
      upstream.resume();
      upstream = await attempt(true);
    }
    if (withLogin && upstream.statusCode === 401) {
      upstream.resume();
      session = null;
      throw new ProxyError(502, 'The live Developer Support API rejected the developer login');
    }
    return upstream;
  }

  const forward = (withLogin) => async (req, res) => {
    try {
      const upstream = await send(req, withLogin);
      res.status(upstream.statusCode);
      RESPONSE_HEADERS.forEach((name) => { if (upstream.headers[name]) res.setHeader(name, upstream.headers[name]); });
      upstream.pipe(res);
    } catch (err) {
      if (res.headersSent) return res.end();
      return fail(res, err.status || 502, err instanceof ProxyError ? err.message : 'Live Developer Support request failed');
    }
  };

  const router = express.Router();
  router.use((req, res, next) => (req.headers[LOOP_HEADER] ? fail(res, 508, 'Developer Support proxy loop') : next()));
  router.get('/media/:id', forward(false));
  if (guard.length) router.use(...guard);
  router.use((req, res, next) => (DEVELOPER_PATH.test(req.url)
    ? next()
    : fail(res, 403, 'On localhost, Developer Support works as the developer only. Report as a client from the live site.')));
  router.use(forward(true));
  return router;
}

module.exports = { createSupportLiveProxy, LOOP_HEADER };
