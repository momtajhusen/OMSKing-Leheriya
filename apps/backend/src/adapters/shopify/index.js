const https = require('https');
const { URL } = require('url');
const { header, verifyHmac } = require('../signature');

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

function later(message) {
  const err = new Error(message);
  err.code = 'PHASE_SHELL';
  return err;
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
  const names = new Set();
  let url = `https://${shop}/admin/api/2024-10/products.json?fields=vendor&limit=250`;
  for (let page = 0; page < 4 && url; page += 1) {
    const res = await httpGet(url, {
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

async function pullCatalog(creds, { request = httpGet } = {}) {
  const shop = shopOf(creds);
  const token = String(creds?.adminToken || '').trim();
  if (!shop || !token) {
    const err = new Error('Shopify catalog was not pulled. Shop URL and Admin API token are missing, so the products API was not called.');
    err.statusCode = 400;
    throw err;
  }
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
  pullOrders: async () => { throw later('Shopify order pull starts in Phase 3'); },
  pushInventory: async () => { throw later('Shopify inventory push starts in Phase 4'); },
};
