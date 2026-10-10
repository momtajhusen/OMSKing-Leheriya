const Product = require('../models/Product');
const MasterSku = require('../models/MasterSku');
const SkuMapping = require('../models/SkuMapping');

function isPlaceholder(url) {
  return /example\.com|picsum\.photos|via\.placeholder\.com|placehold\.co|placeholder\.com|dummyimage\.com|placekitten\.com|loremflickr\.com/i.test(url);
}

function firstImage(images) {
  if (!Array.isArray(images)) return '';
  for (const item of images) {
    if (typeof item !== 'string') continue;
    const url = item.trim();
    if (!url || isPlaceholder(url)) continue;
    if (/^https?:\/\//i.test(url) || url.startsWith('/uploads/')) return url;
  }
  return '';
}

function remember(bySku, key, url) {
  const norm = String(key || '').trim().toLowerCase();
  if (norm && url && !bySku.has(norm)) bySku.set(norm, url);
}

/** Exact SKU, then the same code without a leading M or A (Myntra/Amazon seller prefix). */
function imageForSku(bySku, sku) {
  const key = String(sku || '').trim().toLowerCase();
  if (!key || !bySku) return '';
  if (bySku.has(key)) return bySku.get(key) || '';
  if (key.length > 4 && /^[ma]/.test(key) && bySku.has(key.slice(1))) return bySku.get(key.slice(1)) || '';
  return '';
}

async function imagesBySku(tenantId) {
  const [products, masters, mappings] = await Promise.all([
    Product.find({ tenantId }).select('images').setOptions({ skipTenantFilter: true }).lean(),
    MasterSku.find({ tenantId }).select('code productId').setOptions({ skipTenantFilter: true }).lean(),
    SkuMapping.find({ tenantId, masterSkuId: { $ne: null } })
      .select('channelSkuCode channelVariantId masterSkuId')
      .setOptions({ skipTenantFilter: true })
      .lean(),
  ]);
  const byProduct = new Map();
  products.forEach((product) => {
    const url = firstImage(product.images);
    if (url) byProduct.set(String(product._id), url);
  });
  const bySku = new Map();
  const urlForMaster = new Map();
  masters.forEach((master) => {
    const url = byProduct.get(String(master.productId));
    if (!url) return;
    urlForMaster.set(String(master._id), url);
    remember(bySku, master.code, url);
    bySku.set(`id:${master._id}`, url);
  });
  mappings.forEach((mapping) => {
    const url = urlForMaster.get(String(mapping.masterSkuId));
    if (!url) return;
    remember(bySku, mapping.channelSkuCode, url);
    remember(bySku, mapping.channelVariantId, url);
  });
  return bySku;
}

function withImage(row, bySku) {
  if (!row) return row;
  const own = firstImage([row.imageUrl]);
  if (own) return row;
  const url = firstImage([
    imageForSku(bySku, row.sku || row.code),
    row.masterSkuId ? bySku.get(`id:${row.masterSkuId}`) : '',
  ]);
  if (url) return { ...row, imageUrl: url };
  if (row.imageUrl) return { ...row, imageUrl: '' };
  return row;
}

function paintOrder(order, bySku) {
  if (!order || !bySku?.size) return order;
  return {
    ...order,
    items: (order.items || []).map((item) => withImage(item, bySku)),
    subOrders: (order.subOrders || []).map((sub) => withImage(sub, bySku)),
    channelLines: (order.channelLines || []).map((line) => withImage(line, bySku)),
  };
}

module.exports = { firstImage, imageForSku, imagesBySku, withImage, paintOrder };
