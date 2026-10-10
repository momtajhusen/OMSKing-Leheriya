const { header, verifyHmac } = require('../signature');
const { httpsRequest } = require('../http');

function tokenOf(creds) {
  return String(creds?.apiToken || creds?.applicationSecret || creds?.token || creds?.secretKey || '').trim();
}

function sellerOf(creds) {
  return String(creds?.supplierId || creds?.vendorCode || creds?.partnerId || creds?.applicationId || creds?.sellerId || '').trim();
}

function baseOf(creds) {
  return String(creds?.apiBaseUrl || '').trim().replace(/\/$/, '');
}

function shopOf(creds) {
  return sellerOf(creds).toLowerCase();
}

function secretOf(creds) {
  return creds?.webhookSecret || tokenOf(creds);
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

function authHeaders(creds) {
  return {
    Authorization: `Bearer ${tokenOf(creds)}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Seller-Id': sellerOf(creds),
  };
}

function ready(creds) {
  if (baseOf(creds) && tokenOf(creds)) return;
  const err = new Error('API host and token are required before this channel API is called.');
  err.statusCode = 400;
  err.terminal = true;
  throw err;
}

async function call(request, method, url, creds, body) {
  const result = await request(url, {
    method,
    headers: authHeaders(creds),
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'status') && Object.prototype.hasOwnProperty.call(result, 'text')) {
    if (result.status < 200 || result.status >= 300) {
      const err = new Error(`Channel HTTP ${result.status}`);
      err.statusCode = result.status >= 400 && result.status < 500 ? 400 : 502;
      err.terminal = result.status >= 400 && result.status < 500;
      throw err;
    }
    return result.text ? JSON.parse(result.text) : {};
  }
  return result || {};
}

function defaultRequest(url, options) {
  return httpsRequest(url, options);
}

function asList(body, keys) {
  if (Array.isArray(body)) return body;
  for (const key of keys) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

function statusOf(value) {
  const text = String(value || '').trim();
  const known = ['New', 'Processing', 'Pending', 'Packed', 'Ready to Ship', 'Dispatched', 'Delivered', 'Cancelled', 'Unfulfillable'];
  if (known.includes(text)) return text;
  if (/cancel/i.test(text)) return 'Cancelled';
  if (/deliver/i.test(text)) return 'Delivered';
  if (/ship|dispatch|transit/i.test(text)) return 'Dispatched';
  return 'New';
}

function catalogRows(body) {
  return asList(body, ['products', 'listings', 'items', 'data']).map((row) => ({
    channelSkuCode: String(row.channelSkuCode || row.sku || row.skuCode || row.sellerSku || '').trim(),
    channelProductId: String(row.channelProductId || row.productId || row.id || ''),
    channelVariantId: String(row.channelVariantId || row.variantId || row.sku || row.id || ''),
    channelTitle: String(row.channelTitle || row.title || row.name || ''),
    price: row.price ?? row.sellingPrice,
    barcode: row.barcode || '',
    image: row.image || row.imageUrl || '',
  })).filter((row) => row.channelSkuCode);
}

function orderRows(body) {
  return asList(body, ['orders', 'data']).map((row) => ({
    externalOrderId: String(row.externalOrderId || row.orderId || row.order_id || row.id || '').trim(),
    status: statusOf(row.status),
    paymentMode: row.paymentMode || row.paymentMethod || 'Prepaid',
    total: Number(row.total || row.amount || 0) || 0,
    orderDate: row.orderDate || row.createdAt || new Date(),
    items: (row.items || row.lines || []).map((item) => ({
      sku: String(item.sku || item.channelSkuCode || '').trim(),
      name: item.name || item.title || item.sku || '',
      qty: Number(item.qty || item.quantity || 1) || 1,
      price: Number(item.price || 0) || 0,
      imageUrl: item.imageUrl || item.image || '',
    })),
  })).filter((row) => row.externalOrderId);
}

async function pullCatalog(creds, { request = defaultRequest } = {}) {
  ready(creds);
  const path = creds.productsPath || '/products';
  const body = await call(request, 'GET', `${baseOf(creds)}${path}`, creds);
  return { rows: catalogRows(body), locations: [] };
}

async function pullOrders(creds, { request = defaultRequest } = {}) {
  ready(creds);
  const path = creds.ordersPath || '/orders';
  const body = await call(request, 'GET', `${baseOf(creds)}${path}`, creds);
  return orderRows(body);
}

async function pushInventory(creds, { sku, quantity, request = defaultRequest } = {}) {
  ready(creds);
  const sellerSku = String(sku || '').trim();
  if (!sellerSku) {
    const err = new Error('Stock was not pushed. The seller SKU is missing.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  const path = creds.inventoryPath || '/inventory';
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  await call(request, 'POST', `${baseOf(creds)}${path}`, creds, { items: [{ sku: sellerSku, quantity: qty }] });
  return `${sellerSku} quantity ${qty}.`;
}

async function ping(creds, request = defaultRequest) {
  if (!baseOf(creds) || !tokenOf(creds)) {
    return { ok: false, message: 'API host and token are required' };
  }
  try {
    await call(request, 'GET', baseOf(creds), creds);
    return { ok: true, message: 'Channel API reachable' };
  } catch (err) {
    return { ok: false, message: err.message || 'Channel API did not respond' };
  }
}

module.exports = {
  shopOf,
  secretOf,
  verify,
  eventId,
  shopHint,
  topicOf,
  tokenOf,
  sellerOf,
  baseOf,
  pullCatalog,
  pullOrders,
  pushInventory,
  ping,
  catalogRows,
  orderRows,
};
