const https = require('https');
const { URL } = require('url');
const { header, verifyHmac } = require('../signature');
const { gatedRequest } = require('../liveGate');

function shopHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

function secretOf(creds) {
  return creds?.webhookSecret || creds?.apiSecret || '';
}

function shopOf(creds) {
  return shopHost(creds?.shopUrl);
}

function verify({ rawBody, headers, creds }) {
  return verifyHmac({ rawBody, headers, secret: secretOf(creds) });
}

function eventId(headers, body) {
  return header(headers, 'x-oms-event-id')
    || header(headers, 'x-shopify-webhook-id')
    || (body && (body.eventId || body.id))
    || '';
}

function shopHint(headers) {
  return shopHost(header(headers, 'x-oms-shop') || header(headers, 'x-shopify-shop-domain'));
}

function topicOf(headers, body) {
  return header(headers, 'x-oms-topic') || header(headers, 'x-shopify-topic') || body?.topic || '';
}

function httpCall(method, url, { headers = {}, body } = {}) {
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
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timed out reaching ${u.hostname}`));
    });
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      protocol: 'https:',
      hostname: u.hostname,
      port: 443,
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      family: 4,
      timeout: 20000,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timed out reaching ${u.hostname}`));
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

function nextPage(linkHeader) {
  const parts = String(linkHeader || '').split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return '';
}

async function listProductVendors(creds) {
  const shop = shopOf(creds);
  const token = String(creds?.adminToken || '').trim();
  if (!shop || !token) {
    const err = new Error('Save the Shopify shop URL and Admin API token in Settings → Channel Connections first');
    err.statusCode = 400;
    throw err;
  }
  const request = gatedRequest(creds, undefined, httpGet, { allowSandbox: true });
  const names = new Set();
  let url = `https://${shop}/admin/api/2024-10/products.json?fields=vendor&limit=250`;
  for (let page = 0; page < 4 && url; page += 1) {
    const res = await request(url, {
      'X-Shopify-Access-Token': token,
      Accept: 'application/json',
    });
    if (res.status === 401 || res.status === 403) {
      const err = new Error('Shopify rejected the Admin API token');
      err.statusCode = 400;
      throw err;
    }
    if (res.status < 200 || res.status >= 300) {
      const err = new Error('Shopify did not return product vendors');
      err.statusCode = 502;
      throw err;
    }
    const body = JSON.parse(res.text || '{}');
    (body.products || []).forEach((product) => {
      const name = String(product.vendor || '').trim();
      if (name && !/^(null|void)$/i.test(name)) names.add(name);
    });
    url = nextPage(res.headers.link);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function shopifyImage(product, variant) {
  const images = product?.images || [];
  const matched = variant?.image_id
    ? images.find((img) => String(img.id) === String(variant.image_id))
    : null;
  return matched?.src || product?.image?.src || images[0]?.src || '';
}

function variantRows(product) {
  return (product?.variants || []).flatMap((variant) => {
    const sku = String(variant?.sku || '').trim();
    if (!sku) return [];
    const title = [product.title, variant.title].filter((part) => part && part !== 'Default Title').join(' / ');
    return [{
      channelSkuCode: sku,
      channelVariantId: String(variant.id),
      channelProductId: String(product.id),
      channelTitle: title || sku,
      barcode: variant.barcode || '',
      price: variant.price,
      image: shopifyImage(product, variant),
    }];
  });
}

async function pullCatalog(creds, opts = {}) {
  const shop = shopOf(creds);
  const token = String(creds?.adminToken || '').trim();
  if (!shop || !token) {
    const err = new Error('Shopify catalog was not pulled. Shop URL and Admin API token are missing, so the products API was not called.');
    err.statusCode = 400;
    throw err;
  }
  const request = gatedRequest(creds, opts.request, httpGet, { allowSandbox: true });
  const headers = { 'X-Shopify-Access-Token': token, Accept: 'application/json' };
  const products = [];
  let url = `https://${shop}/admin/api/2024-10/products.json?limit=250`;
  for (let page = 0; page < 40 && url; page += 1) {
    const res = await request(url, headers);
    if (res.status === 401 || res.status === 403) {
      const err = new Error('Shopify rejected the Admin API token. Products were not pulled.');
      err.statusCode = 400;
      throw err;
    }
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`Shopify products API returned ${res.status}. Catalog was not pulled.`);
      err.statusCode = 502;
      throw err;
    }
    const body = JSON.parse(res.text || '{}');
    products.push(...(body.products || []));
    url = nextPage(res.headers?.link || res.headers?.Link);
  }
  const locRes = await request(`https://${shop}/admin/api/2024-10/locations.json`, headers);
  let locations = [];
  if (locRes.status >= 200 && locRes.status < 300) {
    const body = JSON.parse(locRes.text || '{}');
    locations = (body.locations || []).map((loc) => ({
      id: String(loc.id),
      name: loc.name || '',
      active: loc.active !== false,
    }));
  }
  return { rows: products.flatMap(variantRows), locations };
}

function shopifyHeaders(token) {
  return {
    'X-Shopify-Access-Token': token,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function requireShop(creds) {
  const shop = shopOf(creds);
  const token = String(creds?.adminToken || '').trim();
  if (!shop || !token) {
    const err = new Error('Shopify stock was not pushed. Shop URL and Admin API token are missing, so the inventory API was not called.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  return { shop, token };
}

async function inventoryItemId(shop, token, variantId, request) {
  const res = await request('GET', `https://${shop}/admin/api/2024-10/variants/${encodeURIComponent(variantId)}.json`, {
    headers: shopifyHeaders(token),
  });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Shopify variant ${variantId} returned ${res.status}. Stock was not pushed.`);
    err.statusCode = res.status === 401 || res.status === 403 || res.status === 404 ? 400 : 502;
    err.terminal = err.statusCode === 400;
    throw err;
  }
  const id = JSON.parse(res.text || '{}').variant?.inventory_item_id;
  if (!id) {
    const err = new Error(`Shopify variant ${variantId} has no inventory item. Stock was not pushed.`);
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  return id;
}

async function pushInventory(creds, opts = {}) {
  const rows = opts.rows || [];
  const { shop, token } = requireShop(creds);
  const request = gatedRequest(creds, opts.request, httpCall, { allowSandbox: true });
  const sent = [];
  for (const row of rows) {
    const locationId = String(row.locationId || '');
    if (!locationId || locationId.startsWith('shopify-location-')) {
      const err = new Error('Shopify stock was not pushed. Location A and B are still placeholders. Bind the real Shopify location ids first.');
      err.statusCode = 400;
      err.terminal = true;
      throw err;
    }
    const itemId = await inventoryItemId(shop, token, row.variantId, request);
    const available = Math.max(0, Math.floor(Number(row.available) || 0));
    const res = await request('POST', `https://${shop}/admin/api/2024-10/inventory_levels/set.json`, {
      headers: shopifyHeaders(token),
      body: { location_id: Number(locationId), inventory_item_id: itemId, available },
    });
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`Shopify inventory set returned ${res.status}. Stock was not pushed.`);
      err.statusCode = res.status === 401 || res.status === 403 || res.status === 404 || res.status === 422 ? 400 : 502;
      err.terminal = err.statusCode === 400;
      throw err;
    }
    sent.push({ locationId, available });
  }
  return { sent };
}

async function readLocationAvailable(creds, opts = {}) {
  const { variantId, locationId } = opts;
  const { shop, token } = requireShop(creds);
  const request = gatedRequest(creds, opts.request, httpCall, { allowSandbox: true });
  if (!locationId || String(locationId).startsWith('shopify-location-')) {
    const err = new Error('Shopify location qty was not read. Location A is still a placeholder.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  const itemId = await inventoryItemId(shop, token, variantId, request);
  const qs = new URLSearchParams({
    inventory_item_ids: String(itemId),
    location_ids: String(locationId),
  });
  const res = await request('GET', `https://${shop}/admin/api/2024-10/inventory_levels.json?${qs}`, {
    headers: shopifyHeaders(token),
  });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Shopify inventory level returned ${res.status}. WH-001 was not updated.`);
    err.statusCode = res.status === 401 || res.status === 403 ? 400 : 502;
    err.terminal = err.statusCode === 400;
    throw err;
  }
  const level = (JSON.parse(res.text || '{}').inventory_levels || [])[0];
  return Math.max(0, Math.floor(Number(level?.available) || 0));
}

async function fulfillOrder(creds, opts = {}) {
  const { orderId, trackingNumber } = opts;
  const { shop, token } = requireShop(creds);
  const request = gatedRequest(creds, opts.request, httpCall, { allowSandbox: true });
  const headers = shopifyHeaders(token);
  const listed = await request('GET', `https://${shop}/admin/api/2024-10/orders/${encodeURIComponent(orderId)}/fulfillment_orders.json`, { headers });
  if (listed.status < 200 || listed.status >= 300) {
    const err = new Error(`Shopify fulfillments returned ${listed.status}. The AWB was booked, but Shopify was not marked fulfilled.`);
    err.statusCode = 502;
    throw err;
  }
  const fulfillmentOrderId = JSON.parse(listed.text || '{}').fulfillment_orders?.[0]?.id;
  if (!fulfillmentOrderId) {
    const err = new Error('Shopify has no open fulfillment order. Tracking was not sent.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  const created = await request('POST', `https://${shop}/admin/api/2024-10/fulfillments.json`, {
    headers,
    body: {
      fulfillment: {
        notify_customer: false,
        tracking_info: { number: trackingNumber, company: 'Delhivery' },
        line_items_by_fulfillment_order: [{ fulfillment_order_id: fulfillmentOrderId }],
      },
    },
  });
  if (created.status < 200 || created.status >= 300) {
    const err = new Error(`Shopify fulfillment create returned ${created.status}.`);
    err.statusCode = 502;
    throw err;
  }
  const id = JSON.parse(created.text || '{}').fulfillment?.id;
  return { fulfillmentId: id ? String(id) : '' };
}

async function cancelFulfillment(creds, opts = {}) {
  const { fulfillmentId } = opts;
  const { shop, token } = requireShop(creds);
  const request = gatedRequest(creds, opts.request, httpCall, { allowSandbox: true });
  const res = await request('POST', `https://${shop}/admin/api/2024-10/fulfillments/${encodeURIComponent(fulfillmentId)}/cancel.json`, {
    headers: shopifyHeaders(token),
  });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Shopify did not mark the order unfulfilled (${res.status}).`);
    err.statusCode = 502;
    throw err;
  }
  return { fulfillmentId };
}

function codGateways(creds) {
  return String(creds?.codGateways || 'COD, Cash on Delivery')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function shopifyPayment(order, creds) {
  const financial = String(order?.financial_status || '').toLowerCase();
  if (financial === 'voided') return 'Void';
  if (financial === 'partially_paid') return 'Partially paid';
  const names = [...(order?.payment_gateway_names || []), order?.gateway]
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());
  const gates = codGateways(creds);
  if (names.some((name) => gates.some((gate) => name.includes(gate)))) return 'COD';
  return 'Prepaid';
}

function mapShopifyOrder(order, creds) {
  const externalOrderId = String(order?.id || '').trim();
  if (!externalOrderId || !Array.isArray(order?.line_items)) return null;
  const cancelled = Boolean(order.cancelled_at);
  const items = order.line_items.map((line) => ({
    name: String(line.title || line.sku || ''),
    sku: String(line.sku || '').trim(),
    imageUrl: String(line.image?.src || line.image_url || '').trim(),
    qty: Math.max(1, Number(line.quantity) || 1),
    price: Number(line.price) || 0,
    locationId: String(line.origin_location?.id || order.location_id || ''),
  })).filter((line) => line.sku);
  return {
    externalOrderId,
    status: cancelled ? 'Cancelled' : (order.fulfillment_status === 'fulfilled' ? 'Dispatched' : 'New'),
    paymentMode: shopifyPayment(order, creds),
    total: Number(order.total_price) || 0,
    orderDate: order.created_at ? new Date(order.created_at) : new Date(),
    customer: String(order.shipping_address?.name || ''),
    email: String(order.email || ''),
    phone: String(order.shipping_address?.phone || order.phone || ''),
    address: String(order.shipping_address?.address1 || ''),
    city: String(order.shipping_address?.city || ''),
    shipState: String(order.shipping_address?.province || ''),
    items,
    sourceOrderData: {
      id: externalOrderId,
      financial_status: order.financial_status || '',
      fulfillment_status: order.fulfillment_status || '',
      cancelled_at: order.cancelled_at || '',
      location_id: String(order.location_id || ''),
      gateways: order.payment_gateway_names || [],
    },
  };
}

async function pullOrders(creds, opts = {}) {
  const shop = shopOf(creds);
  const token = String(creds?.adminToken || '').trim();
  if (!shop || !token) {
    const err = new Error('Shopify orders were not pulled. Shop URL and Admin API token are missing, so the orders API was not called.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  const request = gatedRequest(creds, opts.request, httpGet, { allowSandbox: true });
  const since = creds?.importOrdersFrom ? new Date(creds.importOrdersFrom) : new Date(Date.now() - 30 * 864e5);
  const created = Number.isNaN(since.getTime()) ? new Date(Date.now() - 30 * 864e5) : since;
  const headers = { 'X-Shopify-Access-Token': token, Accept: 'application/json' };
  const orders = [];
  let url = `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(created.toISOString())}`;
  for (let page = 0; page < 20 && url; page += 1) {
    const res = await request(url, headers);
    if (res.status === 401 || res.status === 403) {
      const err = new Error('Shopify rejected the Admin API token. Orders were not pulled.');
      err.statusCode = 400;
      err.terminal = true;
      throw err;
    }
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`Shopify orders API returned ${res.status}. Orders were not pulled.`);
      err.statusCode = 502;
      throw err;
    }
    const body = JSON.parse(res.text || '{}');
    (body.orders || []).forEach((order) => {
      const mapped = mapShopifyOrder(order, creds);
      if (mapped) orders.push(mapped);
    });
    url = nextPage(res.headers?.link || res.headers?.Link);
  }
  return orders;
}

function returnRowsFromOrders(orders) {
  const rows = [];
  for (const order of orders || []) {
    const externalOrderId = String(order?.id || '').trim();
    if (!externalOrderId) continue;
    const orderNo = `SHP-${externalOrderId}`;
    const refunds = Array.isArray(order.refunds) && order.refunds.length ? order.refunds : [null];
    for (const refund of refunds) {
      const lines = refund?.refund_line_items?.length
        ? refund.refund_line_items
        : (order.line_items || []).map((item) => ({ quantity: item.quantity, line_item: item }));
      rows.push({
        returnNo: `SHP-RET-${refund?.id || externalOrderId}`,
        orderNo,
        externalOrderId,
        channel: 'Shopify',
        reason: String(refund?.note || order.cancel_reason || 'Customer return'),
        items: lines.map((line) => ({
          sku: String(line.line_item?.sku || line.sku || ''),
          qty: Number(line.quantity) || 1,
          name: String(line.line_item?.title || line.title || ''),
        })).filter((item) => item.sku),
      });
    }
  }
  return rows;
}

async function pullReturns(creds, opts = {}) {
  const shop = shopOf(creds);
  const token = String(creds?.adminToken || '').trim();
  if (!shop || !token) {
    const err = new Error('Shopify returns were not pulled. Shop URL and Admin API token are missing, so the orders API was not called.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  const request = gatedRequest(creds, opts.request, httpGet, { allowSandbox: true });
  const since = creds?.importOrdersFrom ? new Date(creds.importOrdersFrom) : new Date(Date.now() - 30 * 864e5);
  const updated = Number.isNaN(since.getTime()) ? new Date(Date.now() - 30 * 864e5) : since;
  const headers = { 'X-Shopify-Access-Token': token, Accept: 'application/json' };
  const orders = [];
  let url = `https://${shop}/admin/api/2024-10/orders.json?status=any&financial_status=refunded,partially_refunded&limit=50&updated_at_min=${encodeURIComponent(updated.toISOString())}`;
  for (let page = 0; page < 5 && url; page += 1) {
    const res = await request(url, headers);
    if (res.status === 401 || res.status === 403) {
      const err = new Error('Shopify rejected the Admin API token. Returns were not pulled.');
      err.statusCode = 400;
      err.terminal = true;
      throw err;
    }
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`Shopify returns API returned ${res.status}. Returns were not pulled.`);
      err.statusCode = 502;
      throw err;
    }
    const body = JSON.parse(res.text || '{}');
    orders.push(...(body.orders || []));
    url = nextPage(res.headers?.link || res.headers?.Link);
  }
  return returnRowsFromOrders(orders);
}

module.exports = {
  channel: 'shopify',
  secretOf,
  shopOf,
  verify,
  eventId,
  shopHint,
  topicOf,
  listProductVendors,
  variantRows,
  pullCatalog,
  pullProducts: (creds, opts) => pullCatalog(creds, opts).then((result) => result.rows),
  mapShopifyOrder,
  pullOrders,
  pullReturns,
  pushInventory,
  readLocationAvailable,
  fulfillOrder,
  cancelFulfillment,
};
