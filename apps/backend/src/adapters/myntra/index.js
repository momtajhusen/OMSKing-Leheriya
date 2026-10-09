const { header, verifyHmac } = require('../signature');
const { createMyntraClient } = require('./client');

function shopOf(creds) {
  return String(creds?.merchantId || creds?.storeId || '').trim().toLowerCase();
}

function secretOf(creds) {
  return creds?.webhookSecret || creds?.secretKey || '';
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

function httpImage(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? value.trim() : '';
}

function imageOf(product, option) {
  const style = product?.styleImages || {};
  return httpImage(option?.imageUrl)
    || httpImage(option?.imageURL)
    || httpImage(style.default?.imageURL)
    || httpImage(style.front?.imageURL)
    || httpImage(product?.imageUrl)
    || httpImage(product?.imageURL)
    || httpImage(product?.images?.[0]?.imageURL)
    || httpImage(product?.images?.[0]?.src)
    || httpImage(product?.images?.[0]);
}

function skuOf(product, option) {
  return String(
    option?.sku?.sellerSkuCode
    || option?.sellerSkuCode
    || option?.vendorSkuCode
    || option?.skuCode
    || product?.sellerSkuCode
    || product?.vendorSkuCode
    || '',
  ).trim();
}

/** One Fetch Product Listing payload becomes import rows. Seller SKU is required. */
function productRows(products) {
  const rows = [];
  for (const product of products || []) {
    const options = product?.productOptions?.length ? product.productOptions : [product];
    for (const option of options) {
      const sku = skuOf(product, option);
      if (!sku) continue;
      const size = option?.size || option?.sku?.size || '';
      const title = [product?.productName || product?.title || product?.brandName, size]
        .filter((part) => part && part !== 'Default Title')
        .join(' / ');
      rows.push({
        channelSkuCode: sku,
        channelVariantId: String(option?.sku?.skuId || option?.skuId || sku),
        channelProductId: String(product?.productId || product?.styleId || ''),
        channelTitle: title || sku,
        barcode: String(option?.barcode || option?.ean || product?.barcode || ''),
        price: option?.price ?? product?.price,
        mrp: option?.mrp ?? product?.mrp,
        image: imageOf(product, option),
        color: option?.color || product?.baseColour || product?.color || '',
        size,
        category: product?.articleType?.typeName || product?.category || '',
      });
    }
  }
  return rows;
}

async function pullCatalog(creds, { client } = {}) {
  if (!String(creds?.merchantId || '').trim() || !String(creds?.secretKey || '').trim()) {
    const err = new Error('Myntra catalog was not pulled. Merchant Id and Secret Key are missing, so the product list API was not called.');
    err.statusCode = 400;
    throw err;
  }
  const api = client || createMyntraClient(creds);
  const products = await api.listProducts();
  return { rows: productRows(products), locations: [] };
}

module.exports = {
  channel: 'myntra',
  secretOf,
  shopOf,
  verify,
  eventId,
  shopHint,
  topicOf,
  productRows,
  pullCatalog,
  pullProducts: async (creds, opts) => (await pullCatalog(creds, opts)).rows,
  pullOrders: async () => { throw later('Myntra order pull starts in Phase 3'); },
  pushInventory: async () => { throw later('Myntra inventory push starts in Phase 4'); },
};
