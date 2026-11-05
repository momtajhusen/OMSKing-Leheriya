const https = require('https');
const { URL } = require('url');
const { header, verifyHmac } = require('../signature');

const { apiModeOf } = require('../apiMode');
const { gatedRequest, outboundMode } = require('../liveGate');
const { amazonLiveReady } = require('../../services/channelConnection.service');

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
      shipByTime: order.LatestShipDate ? new Date(order.LatestShipDate) : undefined,
      items: [{
        name: order.OrderStatus ? `Amazon ${order.OrderStatus}` : 'Amazon item',
        sku: String(order.AmazonOrderId || ''),
        qty: qty > 0 ? qty : 1,
        price: amount,
      }],
    };
  }).filter((order) => order.externalOrderId);
}

function orderItemRows(payloadItems) {
  return (payloadItems || []).flatMap((item) => {
    const sku = String(item.SellerSKU || '').trim();
    if (!sku) return [];
    const qty = Number(item.QuantityOrdered) || 1;
    return [{
      name: String(item.Title || sku),
      sku,
      qty,
      price: Number(item.ItemPrice?.Amount || 0),
    }];
  });
}

async function withOrderItems(rows, creds, request, token) {
  let throttled = false;
  for (const row of rows) {
    row.itemsKnown = false;
    if (throttled) continue;
    try {
      const res = await request('GET', `${amazonHost(creds)}/orders/v0/orders/${encodeURIComponent(row.externalOrderId)}/orderItems`, {
        headers: { 'x-amz-access-token': token, Accept: 'application/json' },
      });
      if (res?.status === 429) throttled = true;
      if (!res || res.status < 200 || res.status >= 300) continue;
      const body = JSON.parse(res.text || '{}');
      const items = orderItemRows(body.payload?.OrderItems || body.OrderItems);
      if (!items.length) continue;
      row.items = items;
      row.itemsKnown = true;
    } catch {
      continue;
    }
  }
  return rows;
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
  const sellerId = String(creds?.sellerId || '').trim();
  const refreshToken = String(creds?.refreshToken || '').trim();
  const clientId = String(creds?.lwaClientId || '').trim();
  const secret = String(creds?.lwaClientSecret || '').trim();
  if (!sellerId || !refreshToken || !clientId || !secret) {
    const err = new Error('Amazon was not called. Seller ID, refresh token, and LWA client id + secret are required.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
}

function amazonRequest(creds, request) {
  const injected = typeof request === 'function' && request !== httpsCall;
  if (!injected && outboundMode(creds) === 'live' && !amazonLiveReady(creds)) {
    const err = new Error('Live is not connected. Amazon live mode needs the production Seller ID, refresh token, and LWA client id + secret. A sandbox refresh token stays on Sandbox. The live API was not called.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  return gatedRequest(creds, request, httpsCall, { allowSandbox: true });
}

async function pullCatalog(creds, opts = {}) {
  assertAmazonCreds(creds);
  const request = amazonRequest(creds, opts.request);
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

async function pullOrders(creds, opts = {}) {
  assertAmazonCreds(creds);
  const request = amazonRequest(creds, opts.request);
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
  return withOrderItems(orderRows(body.payload?.Orders || body.Orders || []), creds, request, token);
}

function returnRows(list) {
  return (list || []).flatMap((row) => {
    const externalOrderId = String(row.orderId || row.amazonOrderId || '').trim();
    const returnId = String(row.returnId || row.amazonRmaId || '').trim();
    if (!externalOrderId || !returnId) return [];
    const items = (row.returnItems || row.items || []).map((item) => ({
      sku: String(item.merchantSku || item.sellerSku || item.sku || ''),
      qty: Number(item.returnQuantity || item.quantity) || 1,
      name: String(item.itemName || item.title || ''),
    })).filter((item) => item.sku);
    return [{
      returnNo: `AMZ-RET-${returnId}`,
      orderNo: `AMZ-${externalOrderId}`,
      externalOrderId,
      channel: 'Amazon',
      reason: String(row.returnReason || row.merchantReturnReason || 'Customer return'),
      items,
    }];
  });
}

async function pullReturns(creds, opts = {}) {
  assertAmazonCreds(creds);
  const request = amazonRequest(creds, opts.request);
  const token = await accessToken(creds, request);
  const since = creds?.importOrdersFrom ? new Date(creds.importOrdersFrom) : new Date(Date.now() - 30 * 864e5);
  const start = Number.isNaN(since.getTime()) ? new Date(Date.now() - 30 * 864e5) : since;
  const qs = new URLSearchParams({
    marketplaceId: String(creds?.marketplaceId || 'A21TJRUUN4KGV').trim(),
    returnStartDate: start.toISOString(),
  });
  const res = await request('GET', `${amazonHost(creds)}/returns/2024-03-01/returns?${qs}`, {
    headers: { 'x-amz-access-token': token, Accept: 'application/json' },
  });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Amazon returns API returned ${res.status}. ${lwaDetail(res.text) || 'Returns were not pulled.'}`);
    err.statusCode = res.status === 400 || res.status === 401 || res.status === 403 ? 400 : 502;
    if (err.statusCode === 400) err.terminal = true;
    throw err;
  }
  const body = JSON.parse(res.text || '{}');
  return returnRows(body.returns || body.payload?.returns || []);
}

async function pushInventory(creds, opts = {}) {
  assertAmazonCreds(creds);
  const request = amazonRequest(creds, opts.request);
  const { sku, quantity } = opts;
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

function httpsBinary(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { family: 4, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) reject(new Error(`Amazon label download returned ${res.statusCode}`));
        else resolve(Buffer.concat(chunks));
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timed out downloading the Amazon label'));
    });
    req.on('error', reject);
  });
}

const EASY_SHIP = '/easyShip/2022-03-23';
const PICKED_UP = ['PickedUp', 'Delivered', 'Damaged', 'LostInTransit', 'ReturnedToSeller', 'Undeliverable'];

const SANDBOX_REAL_ORDER = 'Amazon sandbox cannot make a label for a real order. It only answers Amazon test examples, so nothing was booked. Switch Amazon to Live in Settings › Channels to make real Easy Ship labels.';

function easyShipError(what, res, sandbox = false) {
  const sandboxMiss = sandbox && res.status === 400 && /Could not match input arguments/i.test(res.text || '');
  const err = new Error(sandboxMiss ? SANDBOX_REAL_ORDER : `Amazon Easy Ship ${what} returned ${res.status}. ${lwaDetail(res.text) || 'Nothing was saved.'}`);
  err.statusCode = res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404 ? 400 : 502;
  err.terminal = err.statusCode === 400;
  return err;
}

function packageView(pkg) {
  if (!pkg) return null;
  const slot = pkg.packageTimeSlot || {};
  return {
    amazonOrderId: String(pkg.scheduledPackageId?.amazonOrderId || ''),
    packageId: String(pkg.scheduledPackageId?.packageId || ''),
    trackingId: String(pkg.trackingDetails?.trackingId || '').trim(),
    status: String(pkg.packageStatus || ''),
    pickedUp: PICKED_UP.includes(pkg.packageStatus),
    slot: { slotId: slot.slotId || '', start: slot.startTime || null, end: slot.endTime || null, handover: slot.handoverMethod || '' },
  };
}

/**
 * Easy Ship for one batch of work on one Amazon token: pickup slots, scheduling a package (with its label documents),
 * looking a package up, moving it to another slot, and downloading the label from Amazon S3.
 */
async function easyShip(creds, opts = {}) {
  assertAmazonCreds(creds);
  const request = amazonRequest(creds, opts.request);
  const download = gatedRequest(creds, opts.download, httpsBinary, { allowSandbox: true });
  const token = await accessToken(creds, request);
  const sandbox = apiModeOf(creds) === 'sandbox';
  const marketplaceId = sandbox ? 'ATVPDKIKX0DER' : String(creds.marketplaceId || 'A21TJRUUN4KGV').trim();
  const call = async (method, path, body) => {
    const res = await request(method, `${amazonHost(creds)}${EASY_SHIP}${path}`, {
      headers: { 'x-amz-access-token': token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body } : {}),
    });
    let json = {};
    try { json = JSON.parse(res.text || '{}'); } catch { json = {}; }
    return { res, json };
  };

  return {
    async slots(amazonOrderId, { weightGrams, lengthCm, breadthCm, heightCm }) {
      const { res, json } = await call('POST', '/timeSlot', {
        marketplaceId,
        amazonOrderId,
        packageDimensions: { length: lengthCm, width: breadthCm, height: heightCm, unit: 'cm' },
        packageWeight: { value: weightGrams, unit: 'g' },
      });
      if (res.status < 200 || res.status >= 300) throw easyShipError('pickup slots', res, sandbox);
      return (json.timeSlots || []).filter((slot) => slot?.slotId);
    },
    async schedule(amazonOrderId, slotId) {
      const { res, json } = await call('POST', '/packages/bulk', {
        marketplaceId,
        orderScheduleDetailsList: [{ amazonOrderId, packageDetails: { packageTimeSlot: { slotId } } }],
        labelFormat: 'PDF',
      });
      if (res.status < 200 || res.status >= 300) throw easyShipError('schedule', res, sandbox);
      const rejected = (json.rejectedOrders || []).find((row) => row.amazonOrderId === amazonOrderId);
      const pkg = packageView((json.scheduledPackages || []).find((row) => row.scheduledPackageId?.amazonOrderId === amazonOrderId));
      return {
        pkg: pkg?.trackingId ? pkg : null,
        rejected: rejected ? (rejected.error?.message || rejected.error?.code || 'Amazon refused this order') : (pkg?.trackingId ? '' : 'Amazon returned no tracking id'),
        documentsUrl: json.printableDocumentsUrl || '',
      };
    },
    async find(amazonOrderId) {
      const qs = new URLSearchParams({ amazonOrderId, marketplaceId });
      const { res, json } = await call('GET', `/package?${qs}`);
      if (res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) throw easyShipError('package lookup', res, sandbox);
      return packageView(json);
    },
    async reschedule(amazonOrderId, packageId, slotId) {
      const { res, json } = await call('PATCH', '/package', {
        marketplaceId,
        updatePackageDetailsList: [{ scheduledPackageId: { amazonOrderId, packageId }, packageTimeSlot: { slotId } }],
      });
      if (res.status < 200 || res.status >= 300) throw easyShipError('reschedule', res, sandbox);
      return packageView((json.packages || [])[0]);
    },
    async label(url) {
      let u;
      try { u = new URL(url); } catch { u = null; }
      if (!u || u.protocol !== 'https:' || !/(^|\.)amazonaws\.com$/.test(u.hostname)) {
        const err = new Error('The Amazon label link is not an Amazon S3 https link, so it was not downloaded.');
        err.statusCode = 502;
        throw err;
      }
      return download(String(url));
    },
  };
}

async function probeConnection(creds, opts = {}) {
  assertAmazonCreds(creds);
  const request = amazonRequest(creds, opts.request);
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
  pullReturns,
  probeConnection,
  pushInventory,
  easyShip,
};
