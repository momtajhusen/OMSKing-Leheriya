const https = require('https');
const { URL } = require('url');
const { header, verifyHmac } = require('../signature');

const { apiModeOf } = require('../apiMode');

const LWA_URL = 'https://api.amazon.com/auth/o2/token';
const LIVE_HOST = 'https://sellingpartnerapi-eu.amazon.com';
const SANDBOX_HOST = 'https://sandbox.sellingpartnerapi-na.amazon.com';

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
    return parsed.errors?.[0]?.message || parsed.error_description || parsed.error || parsed.message || '';
  } catch {
    return String(text || '').replace(/\s+/g, ' ').slice(0, 180);
  }
}

function barcodeOf(attributes) {
  const rows = attributes?.externally_assigned_product_identifier;
  const hit = Array.isArray(rows) ? rows.find((row) => row?.value) : null;
  return hit?.value || '';
}

function amazonHost(creds) {
  return apiModeOf(creds) === 'sandbox' ? SANDBOX_HOST : LIVE_HOST;
}

function listingSearch(creds) {
  if (apiModeOf(creds) === 'sandbox') {
    return new URLSearchParams({
      marketplaceIds: 'ATVPDKIKX0DER,A2EUQ1WTGCTBG2',
      identifiers: 'GM-ZDPI-9B4E,HW-ZDPI-9B4E,TC-ZDPI-9B4E',
      identifiersType: 'SKU',
      includedData: 'summaries,offers,fulfillmentAvailability,issues',
      pageSize: '1',
    });
  }
  return new URLSearchParams({
    marketplaceIds: String(creds?.marketplaceId || 'A21TJRUUN4KGV').trim(),
    includedData: 'summaries,attributes',
    pageSize: '20',
  });
}

function ordersUrl(creds) {
  const host = amazonHost(creds);
  if (apiModeOf(creds) === 'sandbox') {
    return `${host}/orders/v0/orders?MarketplaceIds=ATVPDKIKX0DER&CreatedAfter=TEST_CASE_200`;
  }
  const since = creds?.importOrdersFrom
    ? new Date(creds.importOrdersFrom)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const createdAfter = Number.isNaN(since.getTime())
    ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    : since.toISOString();
  const qs = new URLSearchParams({
    MarketplaceIds: String(creds?.marketplaceId || 'A21TJRUUN4KGV').trim(),
    CreatedAfter: createdAfter,
  });
  return `${host}/orders/v0/orders?${qs}`;
}

const ORDER_STATUS = {
  Pending: 'New',
  Unshipped: 'Ready to Ship',
  PartiallyShipped: 'Dispatched',
  Shipped: 'Dispatched',
  Canceled: 'Cancelled',
  Unfulfillable: 'Cancelled',
  InvoiceUnconfirmed: 'Processing',
  PendingAvailability: 'New',
};

function orderRows(payloadOrders) {
  return (payloadOrders || []).map((order) => {
    const qty = Number(order.NumberOfItemsUnshipped || 0) + Number(order.NumberOfItemsShipped || 0);
    const amount = Number(order.OrderTotal?.Amount || 0);
    return {
      externalOrderId: String(order.AmazonOrderId || ''),
      status: ORDER_STATUS[order.OrderStatus] || 'Processing',
      total: amount,
      orderDate: order.PurchaseDate ? new Date(order.PurchaseDate) : undefined,
      items: [{
        name: order.OrderStatus ? `Amazon ${order.OrderStatus}` : 'Amazon item',
        sku: String(order.AmazonOrderId || ''),
        qty: qty > 0 ? qty : 1,
        price: amount,
      }],
    };
  }).filter((order) => order.externalOrderId);
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
      image: /example\.com/i.test(summary.mainImage?.link || '') ? '' : (summary.mainImage?.link || ''),
    }];
  });
}

async function accessToken(creds, request) {
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
    const err = new Error(`Amazon token was not issued. LWA ${tokenRes.status}: ${lwaDetail(tokenRes.text) || 'token exchange failed'}`);
    err.statusCode = tokenRes.status === 400 || tokenRes.status === 401 || tokenRes.status === 403 ? 400 : 502;
    throw err;
  }
  return tokenBody.access_token;
}

function assertAmazonCreds(creds) {
  if (!String(creds?.sellerId || '').trim() || !creds?.refreshToken || !creds?.lwaClientId || !creds?.lwaClientSecret) {
    const err = new Error('Amazon was not called. Seller ID, refresh token, and LWA client id + secret are required.');
    err.statusCode = 400;
    throw err;
  }
}

async function pullCatalog(creds, { request = httpsCall } = {}) {
  assertAmazonCreds(creds);
  const sellerId = String(creds.sellerId).trim();
  const token = await accessToken(creds, request);
  const sandbox = apiModeOf(creds) === 'sandbox';
  const rows = [];
  let pageToken = '';
  for (let page = 0; page < 50; page += 1) {
    const qs = listingSearch(creds);
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await request(
      'GET',
      `${amazonHost(creds)}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}?${qs}`,
      { headers: { 'x-amz-access-token': token, Accept: 'application/json' } },
    );
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`Amazon listings API returned ${res.status}. ${lwaDetail(res.text) || 'Catalog was not pulled.'}`);
      err.statusCode = res.status === 400 || res.status === 401 || res.status === 403 ? 400 : 502;
      throw err;
    }
    const body = JSON.parse(res.text || '{}');
    rows.push(...listingRows(body.items));
    if (sandbox) break;
    pageToken = body.pagination?.nextToken || '';
    if (!pageToken) break;
  }
  return { rows, locations: [] };
}

async function pullOrders(creds, { request = httpsCall } = {}) {
  assertAmazonCreds(creds);
  const token = await accessToken(creds, request);
  const res = await request('GET', ordersUrl(creds), {
    headers: { 'x-amz-access-token': token, Accept: 'application/json' },
  });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Amazon orders API returned ${res.status}. ${lwaDetail(res.text) || 'Orders were not pulled.'}`);
    err.statusCode = res.status === 400 || res.status === 401 || res.status === 403 ? 400 : 502;
    throw err;
  }
  const body = JSON.parse(res.text || '{}');
  return orderRows(body.payload?.Orders || body.Orders || []);
}

async function pushInventory(creds, { sku, quantity, request = httpsCall } = {}) {
  assertAmazonCreds(creds);
  const sellerSku = String(sku || '').trim();
  if (!sellerSku) {
    const err = new Error('Amazon stock was not pushed. The seller SKU is missing.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  const token = await accessToken(creds, request);
  const marketplaceId = apiModeOf(creds) === 'sandbox'
    ? 'ATVPDKIKX0DER'
    : String(creds.marketplaceId || 'A21TJRUUN4KGV').trim();
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const res = await request(
    'PATCH',
    `${amazonHost(creds)}/listings/2021-08-01/items/${encodeURIComponent(String(creds.sellerId).trim())}/${encodeURIComponent(sellerSku)}?marketplaceIds=${encodeURIComponent(marketplaceId)}`,
    {
      headers: {
        'x-amz-access-token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        productType: 'PRODUCT',
        patches: [{
          op: 'replace',
          path: '/attributes/fulfillment_availability',
          value: [{ fulfillment_channel_code: 'DEFAULT', quantity: qty }],
        }],
      },
    },
  );
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Amazon inventory update returned ${res.status}. ${lwaDetail(res.text) || 'Quantity was not pushed.'}`);
    err.statusCode = res.status === 400 || res.status === 401 || res.status === 403 ? 400 : 502;
    err.terminal = err.statusCode === 400;
    throw err;
  }
  return { sku: sellerSku, quantity: qty };
}

async function confirmShipment(creds, { amazonOrderId, request = httpsCall } = {}) {
  assertAmazonCreds(creds);
  const token = await accessToken(creds, request);
  const marketplaceId = apiModeOf(creds) === 'sandbox'
    ? 'ATVPDKIKX0DER'
    : String(creds.marketplaceId || 'A21TJRUUN4KGV').trim();
  const res = await request(
    'POST',
    `${amazonHost(creds)}/easyShip/2022-03-23/package`,
    {
      headers: {
        'x-amz-access-token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        amazonOrderId: String(amazonOrderId || ''),
        marketplaceId,
      },
    },
  );
  const body = (() => { try { return JSON.parse(res.text || '{}'); } catch { return {}; } })();
  const trackingNumber = String(body.trackingDetails?.trackingId || body.trackingId || '').trim();
  if (res.status < 200 || res.status >= 300 || !trackingNumber) {
    const err = new Error(`Amazon ship API returned ${res.status}. ${lwaDetail(res.text) || 'No marketplace tracking id was returned.'}`);
    err.statusCode = res.status === 400 || res.status === 401 || res.status === 403 ? 400 : 502;
    err.terminal = err.statusCode === 400;
    throw err;
  }
  return { trackingNumber, courier: 'amazon' };
}

async function probeConnection(creds, { request = httpsCall } = {}) {
  assertAmazonCreds(creds);
  const mode = apiModeOf(creds);
  const token = await accessToken(creds, request);
  const res = await request('GET', ordersUrl(creds), {
    headers: { 'x-amz-access-token': token, Accept: 'application/json' },
  });
  if (res.status >= 200 && res.status < 300) {
    return {
      ok: true,
      message: mode === 'sandbox'
        ? 'Amazon sandbox refresh token exchanged and the sandbox orders call returned.'
        : 'Amazon live orders API accepted the seller credentials.',
    };
  }
  const detail = lwaDetail(res.text);
  return {
    ok: false,
    message: mode === 'sandbox'
      ? `Amazon sandbox orders returned ${res.status}. ${detail || 'Sandbox credentials were not accepted.'}`
      : `Amazon live API returned ${res.status}. ${detail || 'Live did not accept these credentials.'} A sandbox refresh token stays on Sandbox.`,
  };
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
  amazonHost,
  pullCatalog,
  pullProducts: (creds, opts) => pullCatalog(creds, opts).then((result) => result.rows),
  pullOrders,
  probeConnection,
  pushInventory,
  confirmShipment,
};
