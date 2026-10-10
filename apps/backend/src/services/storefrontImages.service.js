const https = require('https');
const Tenant = require('../models/Tenant');
const Product = require('../models/Product');
const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');
const { firstImage, imageForSku } = require('../lib/catalogImages');

function httpsImage(value) {
  const raw = String(value || '').trim();
  if (!raw || /example\.com/i.test(raw)) return '';
  const withProtocol = raw.startsWith('//') ? `https:${raw}` : raw;
  return /^https:\/\//i.test(withProtocol) ? withProtocol : '';
}

/** Shopify-style public catalog: variant SKU -> that variant's photo, else the product photo. */
function imagesFromStorefront(products) {
  const bySku = new Map();
  for (const product of products || []) {
    const images = Array.isArray(product.images) ? product.images : [];
    const fallback = httpsImage(images[0]?.src || product.image?.src);
    const variants = Array.isArray(product.variants) && product.variants.length
      ? product.variants
      : [{ sku: product.sku }];
    for (const variant of variants) {
      const sku = String(variant.sku || '').trim().toLowerCase();
      if (!sku || bySku.has(sku)) continue;
      const matched = variant.image_id
        ? images.find((img) => String(img.id) === String(variant.image_id))
        : null;
      const src = httpsImage(matched?.src) || fallback;
      if (src) bySku.set(sku, src);
    }
  }
  return bySku;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') {
      reject(new Error('Storefront catalog must use HTTPS'));
      return;
    }
    const req = https.request({
      protocol: 'https:',
      hostname: target.hostname,
      port: 443,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      family: 4,
      timeout: 25000,
      headers: { Accept: 'application/json', 'User-Agent': 'OMSKing' },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Storefront catalog returned ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timed out reaching ${target.hostname}`));
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchStorefrontImages(storeUrl, { request = getJson } = {}) {
  const origin = new URL(/^https?:\/\//i.test(storeUrl) ? storeUrl : `https://${storeUrl}`).origin;
  const bySku = new Map();
  for (let page = 1; page <= 80; page += 1) {
    const body = await request(`${origin}/products.json?limit=250&page=${page}`);
    const products = body?.products || [];
    if (!products.length) break;
    imagesFromStorefront(products).forEach((url, sku) => {
      if (!bySku.has(sku)) bySku.set(sku, url);
    });
    if (products.length < 250) break;
  }
  return bySku;
}

function assignImage(wanted, productId, sku, bySku) {
  const id = productId ? String(productId) : '';
  if (!id || wanted.has(id)) return;
  const url = imageForSku(bySku, sku);
  if (url) wanted.set(id, url);
}

async function applyStorefrontImages(tenantId, storeUrl, opts = {}) {
  const bySku = await fetchStorefrontImages(storeUrl, opts);
  const [masters, mappings] = await Promise.all([
    MasterSku.find({ tenantId }).select('code productId').setOptions({ skipTenantFilter: true }).lean(),
    SkuMapping.find({ tenantId, masterSkuId: { $ne: null } })
      .select('channelSkuCode channelVariantId masterSkuId')
      .setOptions({ skipTenantFilter: true })
      .lean(),
  ]);
  const masterById = new Map(masters.map((master) => [String(master._id), master]));
  const wanted = new Map();
  masters.forEach((master) => assignImage(wanted, master.productId, master.code, bySku));
  mappings.forEach((mapping) => {
    const master = masterById.get(String(mapping.masterSkuId));
    if (!master) return;
    assignImage(wanted, master.productId, mapping.channelSkuCode, bySku);
    assignImage(wanted, master.productId, mapping.channelVariantId, bySku);
  });
  const products = await Product.find({ _id: { $in: [...wanted.keys()] } }).setOptions({ skipTenantFilter: true });
  let updated = 0;
  for (const product of products) {
    if (firstImage(product.images)) continue;
    const url = wanted.get(String(product._id));
    if (!url) continue;
    product.images = [url];
    await product.save();
    updated += 1;
  }
  return { updated, catalog: bySku.size, matched: wanted.size };
}

async function fillMissingStorefrontImages() {
  const tenants = await Tenant.find({ 'settings.storefrontUrl': { $nin: [null, ''] } })
    .setOptions({ skipTenantFilter: true })
    .lean();
  const results = [];
  for (const tenant of tenants) {
    const url = String(tenant.settings?.storefrontUrl || '').trim();
    if (!url) continue;
    try {
      const result = await applyStorefrontImages(tenant._id, url);
      results.push({ tenantId: String(tenant._id), ...result });
      if (result.updated) console.log(`[images] ${tenant.slug}: saved ${result.updated} product photos`);
    } catch (err) {
      console.error(`[images] ${tenant.slug || tenant.name}: ${err.message}`);
    }
  }
  return results;
}

module.exports = {
  httpsImage,
  imagesFromStorefront,
  fetchStorefrontImages,
  applyStorefrontImages,
  fillMissingStorefrontImages,
};
