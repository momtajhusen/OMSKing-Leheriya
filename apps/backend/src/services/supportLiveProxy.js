const http = require('http');
const https = require('https');
const express = require('express');

const LOOP_HEADER = 'x-omsking-support-proxy';
const DEVELOPER_PATH = /^\/(threads|all-updates)(\/|\?|$)/;
const AS_DEVELOPER = /^\/as-developer\/updates(\/[^/?]+)?(\?.*)?$/;
const REQUEST_HEADERS = ['content-type', 'content-length', 'accept', 'range'];
const RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified', 'content-disposition'];
const RENEW_BEFORE_MS = 60 * 1000;
const MESSAGE_LIST = /^\/(threads\/[^/?]+\/)?messages(\?|$)/;
const COUNTS_TTL_MS = 30 * 1000;
const COUNT_PAGE = 100;
const COUNT_PAGES_MAX = 100;

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

/** The chat filter counts from message DTOs, the same rules as supportChat.service messageCounts. */
const STAGE_FILTER = { waiting_client: 'waiting', needs_input: 'input', blocked: 'blocked' };

function countMessages(rows) {
  const counts = {
    all: 0, pending: 0, progress: 0, waiting: 0, input: 0, blocked: 0, fixed: 0, developer: 0, client: 0,
  };
  for (const m of rows) {
    if (m.event || m.deleted) continue;
    counts.all += 1;
    const update = m.update;
    const held = update && !['done', 'confirmed'].includes(update.status) && STAGE_FILTER[update.stage];
    if (held) counts[held] += 1;
    else if (update ? update.status === 'pending' : m.side === 'tenant') counts.pending += 1;
    if (!update) continue;
    if (update.status === 'in_progress' && !held) counts.progress += 1;
    if (['done', 'confirmed'].includes(update.status)) counts.fixed += 1;
    if (update.markedBy === 'platform') counts.developer += 1;
    if (update.markedBy === 'tenant') counts.client += 1;
  }
  return counts;
}

function tokenClaims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()) || {};
  } catch {
    return {};
  }
}

function tokenExpiry(token) {
  return Number(tokenClaims(token).exp) * 1000 || 0;
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

const ACCOUNTS = {
  developer: { email: 'email', password: 'password', env: 'SUPPORT_LIVE_EMAIL and SUPPORT_LIVE_PASSWORD' },
  client: { email: 'clientEmail', password: 'clientPassword', env: 'SUPPORT_LIVE_CLIENT_EMAIL and SUPPORT_LIVE_CLIENT_PASSWORD' },
};

/**
 * Developer Support on a localhost backend: every request is sent to the live API (live MongoDB), so localhost shows
 * the same chats as the live site. Nothing is stored locally. `settings` is read per request:
 * { url, email, password } is the live developer account (subscriber inbox), { clientEmail, clientPassword } the live
 * client account whose chat the merchant side shows. `guards.developer` / `guards.client` are the local login checks.
 * `/as-developer/updates[/:id]` lets the merchant side on localhost apply developer marks: it is sent to the developer
 * inbox route of the client account's live company, with the developer login.
 */
function createSupportLiveProxy(settings, guards = {}) {
  const sessions = { developer: null, client: null };
  const signingIn = { developer: null, client: null };

  async function signIn(account) {
    const keys = ACCOUNTS[account];
    const email = settings[keys.email];
    const password = settings[keys.password];
    if (!email || !password) {
      throw new ProxyError(503, `Live Developer Support is not set up: add ${keys.env} to apps/backend/.env`);
    }
    const payload = Buffer.from(JSON.stringify({ email, password }));
    let res;
    try {
      res = await upstreamRequest(`${settings.url}/auth/login`, {
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
      throw new ProxyError(502, `The live Developer Support API refused the ${account} login (HTTP ${res.statusCode})`);
    }
    return { token, expiresAt: tokenExpiry(token) };
  }

  async function liveToken(account, renew) {
    const current = sessions[account];
    if (!renew && current && current.expiresAt - RENEW_BEFORE_MS > Date.now()) return current.token;
    if (!signingIn[account]) signingIn[account] = signIn(account).finally(() => { signingIn[account] = null; });
    sessions[account] = await signingIn[account];
    return sessions[account].token;
  }

  async function clientTenant() {
    await liveToken('client', false);
    const tenantId = tokenClaims(sessions.client.token).tenantId;
    if (!tenantId) throw new ProxyError(502, 'The live client login has no company');
    return String(tenantId);
  }

  const asDeveloper = async (req, res, next) => {
    if (!req.url.startsWith('/as-developer/')) return next();
    const match = AS_DEVELOPER.exec(req.url);
    if (!match || req.method !== (match[1] ? 'PATCH' : 'POST')) return fail(res, 404, 'Not found');
    try {
      req.url = `/threads/${encodeURIComponent(await clientTenant())}/updates${match[1] || ''}${match[2] || ''}`;
    } catch (err) {
      return fail(res, err.status || 502, err instanceof ProxyError ? err.message : 'Live Developer Support request failed');
    }
    return forward('developer')(req, res);
  };

  async function send(req, account) {
    const { body, headers: bodyHeaders, replayable } = outgoingBody(req);
    const headers = {};
    REQUEST_HEADERS.forEach((name) => { if (req.headers[name]) headers[name] = req.headers[name]; });
    Object.assign(headers, bodyHeaders);
    const url = `${settings.url}/support${req.url}`;
    const attempt = async (renew) => {
      if (account) headers.authorization = `Bearer ${await liveToken(account, renew)}`;
      try {
        return await upstreamRequest(url, { method: req.method, headers, body });
      } catch {
        throw new ProxyError(502, 'Cannot reach the live Developer Support API');
      }
    };
    let upstream = await attempt(false);
    if (account && upstream.statusCode === 401 && replayable) {
      upstream.resume();
      upstream = await attempt(true);
    }
    if (account && upstream.statusCode === 401) {
      upstream.resume();
      sessions[account] = null;
      throw new ProxyError(502, `The live Developer Support API rejected the ${account} login`);
    }
    return upstream;
  }

  const countCache = new Map();

  async function getLive(account, url) {
    const upstream = await upstreamRequest(url, { method: 'GET', headers: { authorization: `Bearer ${await liveToken(account, false)}` } });
    const json = await readJson(upstream);
    if (upstream.statusCode !== 200 || !Array.isArray(json?.data)) throw new ProxyError(502, 'Live chat page could not be read');
    return json;
  }

  /** A live server without filter counts yet: read the whole chat page by page and count it (cached briefly). */
  async function liveCounts(account, path, fresh = false) {
    const key = `${account} ${path}`;
    const hit = countCache.get(key);
    if (!fresh && hit && hit.at > Date.now() - COUNTS_TTL_MS) return hit.counts;
    const rows = [];
    let before = '';
    for (let page = 0; page < COUNT_PAGES_MAX; page += 1) {
      const json = await getLive(account, `${settings.url}/support${path}?limit=${COUNT_PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      rows.push(...json.data);
      if (!json.meta?.hasMore || !json.data.length) break;
      before = json.data[0].id;
    }
    const counts = countMessages(rows);
    countCache.set(key, { at: Date.now(), counts });
    return counts;
  }

  const withCounts = async (req, res, account) => {
    const upstream = await send(req, account);
    const json = await readJson(upstream);
    if (!json) return fail(res, 502, 'Live Developer Support request failed');
    if (upstream.statusCode === 200 && Array.isArray(json.data) && !json.meta?.counts) {
      try {
        json.meta = { ...json.meta, counts: await liveCounts(account, req.url.split('?')[0], /[?&]fresh=1(&|$)/.test(req.url)) };
      } catch {
        /* the chat still shows; the filters just have no numbers */
      }
    }
    return res.status(upstream.statusCode).json(json);
  };

  const forward = (account) => async (req, res) => {
    if (req.method !== 'GET') countCache.clear();
    try {
      if (account && req.method === 'GET' && MESSAGE_LIST.test(req.url) && !/[?&]before=/.test(req.url)) return await withCounts(req, res, account);
      const upstream = await send(req, account);
      res.status(upstream.statusCode);
      RESPONSE_HEADERS.forEach((name) => { if (upstream.headers[name]) res.setHeader(name, upstream.headers[name]); });
      upstream.pipe(res);
    } catch (err) {
      if (res.headersSent) return res.end();
      return fail(res, err.status || 502, err instanceof ProxyError ? err.message : 'Live Developer Support request failed');
    }
  };

  const developer = express.Router();
  if (guards.developer?.length) developer.use(...guards.developer);
  developer.use(forward('developer'));
  const client = express.Router();
  if (guards.client?.length) client.use(...guards.client);
  client.use(asDeveloper);
  client.use(forward('client'));

  const router = express.Router();
  router.use((req, res, next) => (req.headers[LOOP_HEADER] ? fail(res, 508, 'Developer Support proxy loop') : next()));
  router.get('/media/:id', forward(null));
  router.use((req, res, next) => (DEVELOPER_PATH.test(req.url) ? developer : client)(req, res, next));
  return router;
}

module.exports = { createSupportLiveProxy, LOOP_HEADER, countMessages };
