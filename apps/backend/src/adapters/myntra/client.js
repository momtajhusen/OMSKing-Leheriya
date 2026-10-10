const https = require('https');
const { URL } = require('url');

const DEFAULT_BASE = 'https://api-integration.myntra.com';
// Myntra access tokens live 30 days; refresh a few days early.
const TOKEN_TTL_MS = 25 * 24 * 60 * 60 * 1000;
const ORDER_WINDOW_DAYS = 6;
const INVENTORY_PUSH_BATCH = 10;
const INVENTORY_SEARCH_BATCH = 10;

function baseOf(creds) {
  const raw = String(creds?.apiBaseUrl || '').trim().replace(/\/$/, '');
  if (!raw || /pretr\.com/i.test(raw)) return DEFAULT_BASE;
  return raw;
}

function rawRequest(method, url, { headers = {}, body, timeoutMs = 25000 } = {}) {
  const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') {
      reject(new Error('Channel calls must use HTTPS'));
      return;
    }
    const req = https.request({
      protocol: 'https:',
      hostname: u.hostname,
      port: 443,
      path: `${u.pathname}${u.search}`,
      method,
      family: 4,
      timeout: timeoutMs,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        buffer: Buffer.concat(chunks),
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timed out reaching ${u.hostname}`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function parseJson(buffer) {
  const text = buffer.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return { statusMessage: text.replace(/\s+/g, ' ').slice(0, 200) };
  }
}

function channelError(res, json, fallback) {
  const message = json?.statusMessage || json?.message || fallback;
  const err = new Error(`Myntra ${res.status}: ${message}`);
  // Never surface Myntra's 401/403 as ours: the admin app treats 401 as a dead session.
  err.statusCode = 502;
  err.channelStatus = res.status;
  err.myntraCode = json?.statusCode;
  return err;
}

function ymd(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Splits [from, to] into Myntra-sized windows (the order list rejects ranges over 7 days).
 */
function orderWindows(from, to) {
  const end = new Date(to);
  let start = new Date(from);
  const windows = [];
  while (start <= end) {
    const stop = new Date(Math.min(end.getTime(), start.getTime() + ORDER_WINDOW_DAYS * 864e5));
    windows.push({ startDate: ymd(start), endDate: ymd(stop) });
    start = new Date(stop.getTime() + 864e5);
  }
  return windows;
}

/** Myntra wraps some documents in a multipart envelope and mislabels the rest; return bare PDF bytes. */
function extractPdf(buffer) {
  const start = buffer.indexOf('%PDF-');
  if (start < 0) {
    const err = new Error('Myntra did not return a PDF');
    err.statusCode = 502;
    throw err;
  }
  const eof = buffer.lastIndexOf('%%EOF');
  const end = eof > start ? eof + 5 : buffer.length;
  return buffer.subarray(start, end);
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * creds: decrypted channel credentials.
 * saveTokens: persists { accessToken, refreshToken, tokenIssuedAt } back to the encrypted connection.
 */
function createMyntraClient(creds, { saveTokens, request = rawRequest, retryDelayMs = 1000 } = {}) {
  const state = {
    accessToken: creds?.accessToken || '',
    refreshToken: creds?.refreshToken || '',
    tokenIssuedAt: creds?.tokenIssuedAt ? new Date(creds.tokenIssuedAt).getTime() : 0,
  };
  const base = baseOf(creds);

  async function remember(res) {
    const access = res.headers.access_token;
    if (!access) return false;
    state.accessToken = String(access);
    if (res.headers.refresh_token) state.refreshToken = String(res.headers.refresh_token);
    state.tokenIssuedAt = Date.now();
    if (saveTokens) {
      await saveTokens({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        tokenIssuedAt: new Date(state.tokenIssuedAt).toISOString(),
      });
    }
    return true;
  }

  async function generate() {
    if (!creds?.merchantId || !creds?.secretKey) {
      throw new Error('Myntra Merchant Id and Secret Key are required');
    }
    const res = await request('POST', `${base}/authorization/generate_token`, {
      headers: { secret_key: creds.secretKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: { merchant_id: creds.merchantId },
    });
    const json = parseJson(res.buffer);
    if (res.status < 200 || res.status >= 300 || !(await remember(res))) {
      throw channelError(res, json, 'Token generation failed');
    }
  }

  async function refresh() {
    if (!state.refreshToken) return generate();
    const res = await request('POST', `${base}/authorization/refresh_token`, {
      headers: { refresh_token: state.refreshToken, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: { merchant_id: creds.merchantId },
    });
    if (res.status >= 200 && res.status < 300 && await remember(res)) return undefined;
    return generate();
  }

  async function ensureToken() {
    const fresh = state.accessToken && Date.now() - state.tokenIssuedAt < TOKEN_TTL_MS;
    if (fresh) return;
    await refresh();
  }

  async function call(method, path, { body, binary = false, retried = false } = {}) {
    await ensureToken();
    const res = await request(method, `${base}${path}`, {
      headers: {
        access_token: state.accessToken,
        'x-partner-store': 'myntra',
        'Content-Type': 'application/json',
        Accept: binary ? 'application/pdf' : 'application/json',
      },
      body,
    });
    if ((res.status === 401 || res.status === 477) && !retried) {
      state.tokenIssuedAt = 0;
      await refresh();
      return call(method, path, { body, binary, retried: true });
    }
    // Myntra returns sporadic 5xx on reads; one retry is safe because GET has no side effect.
    if (res.status >= 500 && method === 'GET' && !retried) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      return call(method, path, { body, binary, retried: true });
    }
    if (binary && res.status >= 200 && res.status < 300) {
      return { buffer: extractPdf(res.buffer), contentType: 'application/pdf' };
    }
    const json = parseJson(res.buffer);
    if (res.status < 200 || res.status >= 300 || json?.statusType === 'ERROR') {
      throw channelError(res, json, 'Request failed');
    }
    return json;
  }

  async function listOrderRefs({ from, to, errors = [] }) {
    const refs = [];
    for (const window of orderWindows(from, to)) {
      let page = 0;
      let pages = 1;
      while (page < pages) {
        const qs = `page=${page}&startDate=${window.startDate}&endDate=${window.endDate}`;
        let json;
        try {
          json = await call('GET', `/partner/v4/order/getOrderList?${qs}`);
        } catch (err) {
          errors.push(`${window.startDate}..${window.endDate} page ${page}: ${err.message}`);
          break;
        }
        (json.data || []).forEach((row) => {
          (row.orderLines || []).forEach((line) => {
            refs.push({
              orderId: String(row.orderId),
              orderLineId: String(line.orderLineId),
              sellerOrderId: String(line.sellerOrderId || ''),
            });
          });
        });
        pages = Number(json.pages) || 1;
        page += 1;
      }
    }
    return refs;
  }

  async function getOrder(sellerOrderId) {
    return call('GET', `/partner/v4/order/${encodeURIComponent(sellerOrderId)}`);
  }

  function productsFrom(json) {
    if (Array.isArray(json?.data)) return json.data;
    if (Array.isArray(json?.data?.products)) return json.data.products;
    if (Array.isArray(json?.products)) return json.products;
    return [];
  }

  function nextCursor(json, current) {
    const next = json?.nextCursorMark || json?.data?.nextCursorMark || json?.status?.nextCursorMark;
    if (!next || next === current || next === '*') return '';
    return String(next);
  }

  /**
   * Fetch Product Listing: GET /partner/catalog/v2/product/search/nofilter
   * Active (A) and seller-approved (APR) listings, paged by cursorMark.
   */
  async function listProducts() {
    const rows = [];
    let cursor = '*';
    let start = 0;
    for (let page = 0; page < 40; page += 1) {
      const qs = new URLSearchParams({
        q: 'listingStatus.eq:A',
        start: String(start),
        cursorMark: cursor,
        sellerApprovalStatus: 'APR',
      });
      let json;
      try {
        json = await call('GET', `/partner/catalog/v2/product/search/nofilter?${qs}`);
      } catch (err) {
        if (err.channelStatus === 403) {
          const refused = new Error('Myntra product list refused this seller account. The catalog API is /partner/catalog/v2/product/search/nofilter. Myntra said: This request is not valid. Catalog reconciliation is not enabled for this account, so listings were not returned. Orders, labels, and invoices still work.');
          refused.statusCode = 502;
          refused.channelStatus = 403;
          throw refused;
        }
        throw err;
      }
      const batch = productsFrom(json);
      rows.push(...batch);
      const next = nextCursor(json, cursor);
      if (!batch.length || !next) break;
      cursor = next;
      start += batch.length;
    }
    return rows;
  }

  async function searchInventory(skus) {
    const rows = [];
    const failed = [];
    for (const batch of chunk([...new Set(skus.filter(Boolean))], INVENTORY_SEARCH_BATCH)) {
      let json;
      try {
        json = await call('POST', '/partner/v4/inventory/search', { body: batch });
      } catch (err) {
        if (err.channelStatus === 403) {
          const refused = new Error('Myntra inventory search refused these seller SKUs. Order, label, and invoice APIs work on this account. Myntra said: This request is not valid. Inventory reconciliation is not enabled for these SKUs.');
          refused.statusCode = 502;
          refused.channelStatus = 403;
          throw refused;
        }
        throw err;
      }
      rows.push(...(json.inventoryDetails || []));
      failed.push(...(json.failedEntries || []).map((entry) => (
        typeof entry === 'string' ? { sku: entry, message: 'Unknown SKU' } : entry
      )));
    }
    return { rows, failed };
  }

  async function updateInventory(items, { storeCode, processingSla = 2 } = {}) {
    const results = [];
    for (const batch of chunk(items, INVENTORY_PUSH_BATCH)) {
      const body = batch.map((item) => ({
        sku: String(item.sku),
        quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)),
        processingSla: Number(item.processingSla || processingSla),
        store_code: item.storeCode || storeCode,
      }));
      results.push(await call('PUT', '/partner/v4/inventory/update', { body }));
    }
    return results;
  }

  async function readyToDispatch(body) {
    return call('PUT', '/partner/v4/order/readyToDispatch', { body });
  }

  async function shippingLabel(packetId) {
    return call('GET', `/partner/v4/packet/${encodeURIComponent(packetId)}/shippingLabel/`, { binary: true });
  }

  async function invoice(packetId) {
    return call('GET', `/partner/v4/packet/${encodeURIComponent(packetId)}/getDocument/?type=invoice`, { binary: true });
  }

  async function listReturns({ from, to } = {}) {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 10 * 864e5);
    const qs = new URLSearchParams({
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    });
    const json = await call('GET', `/partner/v4/return/getReturnList?${qs}`);
    return json.data || json.returns || json.returnOrders || [];
  }

  return {
    base,
    listOrderRefs,
    listProducts,
    getOrder,
    listReturns,
    searchInventory,
    updateInventory,
    readyToDispatch,
    shippingLabel,
    invoice,
  };
}

module.exports = {
  createMyntraClient,
  orderWindows,
  extractPdf,
  rawRequest,
  DEFAULT_BASE,
};
