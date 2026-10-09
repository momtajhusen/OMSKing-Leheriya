const https = require('https');
const { URL } = require('url');
const { header, verifyHmac } = require('../signature');

const LWA_URL = 'https://api.amazon.com/auth/o2/token';
const LISTINGS_HOST = 'https://sellingpartnerapi-eu.amazon.com';

function shopOf(creds) {
  return String(creds?.sellerId || '').trim().toLowerCase();
}

function secretOf(creds) {
  return creds?.webhookSecret || creds?.lwaClientSecret || '';
}

function verify({ rawBody, headers, creds }) {
  return verifyHmac({ rawBody, headers, secret: secretOf(creds) });
}

function eventId(headers, body) {
  return header(headers, 'x-oms-event-id') || (body && (body.eventId || body.id)) || '';
}

function shopHint(headers) {
  return String(header(headers, 'x-oms-shop') || '').trim().toLowerCase();
}

function topicOf(headers, body) {
  return header(headers, 'x-oms-topic') || body?.topic || '';
}

function later(message) {
  const err = new Error(message);
  err.code = 'PHASE_SHELL';
  return err;
}

function httpsCall(method, url, { headers = {}, body } = {}) {
  const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') {
      const err = new Error('Channel calls must use HTTPS');
      err.statusCode = 400;
      reject(err);
      return;
    }
    const req = https.request({
      protocol: 'https:',
      hostname: u.hostname,
      port: 443,
      path: `${u.pathname}${u.search}`,
      method,
      family: 4,
      timeout: 20000,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
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

function lwaDetail(text) {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed.error_description || parsed.error || parsed.message || '';
  } catch {
    return String(text || '').replace(/\s+/g, ' ').slice(0, 180);
  }
}

function barcodeOf(attributes) {
  const rows = attributes?.externally_assigned_product_identifier;
  const hit = Array.isArray(rows) ? rows.find((row) => row?.value) : null;
  return hit?.value || '';
}

function listingRows(items) {
  return (items || []).flatMap((item) => {
    const sku = String(item?.sku || '').trim();
    if (!sku) return [];
    const summary = (item.summaries || [])[0] || {};
    return [{
      channelSkuCode: sku,
      channelVariantId: sku,
      channelProductId: summary.asin || '',
      channelTitle: summary.itemName || sku,
      barcode: barcodeOf(item.attributes),
      image: summary.mainImage?.link || '',
    }];
  });
}

async function pullCatalog(creds, { request = httpsCall } = {}) {
  const sellerId = String(creds?.sellerId || '').trim();
  const marketplaceId = String(creds?.marketplaceId || 'A21TJRUUN4KGV').trim();
  if (!sellerId || !creds?.refreshToken || !creds?.lwaClientId || !creds?.lwaClientSecret) {
    const err = new Error('Amazon catalog was not pulled. Seller ID, refresh token, and LWA client id + secret are required before the listings API is called.');
    err.statusCode = 400;
    throw err;
  }
  const tokenRes = await request('POST', LWA_URL, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.lwaClientId,
      client_secret: creds.lwaClientSecret,
    }).toString(),
  });
  const tokenBody = (() => { try { return JSON.parse(tokenRes.text || '{}'); } catch { return {}; } })();
  if (tokenRes.status < 200 || tokenRes.status >= 300 || !tokenBody.access_token) {
    const err = new Error(`Amazon listings were not pulled. LWA ${tokenRes.status}: ${lwaDetail(tokenRes.text) || 'token exchange failed'}`);
    err.statusCode = tokenRes.status === 400 || tokenRes.status === 401 || tokenRes.status === 403 ? 400 : 502;
    throw err;
  }
  const rows = [];
  let pageToken = '';
  for (let page = 0; page < 50; page += 1) {
    const qs = new URLSearchParams({
      marketplaceIds: marketplaceId,
      includedData: 'summaries,attributes',
      pageSize: '20',
    });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await request(
      'GET',
      `${LISTINGS_HOST}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}?${qs}`,
      { headers: { 'x-amz-access-token': tokenBody.access_token, Accept: 'application/json' } },
    );
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`Amazon listings API returned ${res.status}. ${lwaDetail(res.text) || 'Catalog was not pulled.'}`);
      err.statusCode = res.status === 401 || res.status === 403 ? 400 : 502;
      throw err;
    }
    const body = JSON.parse(res.text || '{}');
    rows.push(...listingRows(body.items));
    pageToken = body.pagination?.nextToken || '';
    if (!pageToken) break;
  }
  return { rows, locations: [] };
}

module.exports = {
  channel: 'amazon',
  secretOf,
  shopOf,
  verify,
  eventId,
  shopHint,
  topicOf,
  listingRows,
  pullCatalog,
  pullProducts: (creds, opts) => pullCatalog(creds, opts).then((result) => result.rows),
  pullOrders: async () => { throw later('Amazon order pull starts in Phase 3'); },
  pushInventory: async () => { throw later('Amazon inventory push starts in Phase 4'); },
};
