const Product = require('../models/Product');
const MasterSku = require('../models/MasterSku');

function firstImage(images) {
  if (!Array.isArray(images)) return '';
  const url = images.find((item) => typeof item === 'string' && /^https?:\/\//i.test(item.trim()));
  return url ? url.trim() : '';
}

async function imagesBySku(tenantId) {
  const [products, masters] = await Promise.all([
    Product.find({ tenantId }).select('images').setOptions({ skipTenantFilter: true }).lean(),
    MasterSku.find({ tenantId }).select('code productId').setOptions({ skipTenantFilter: true }).lean(),
  ]);
  const byProduct = new Map();
  products.forEach((product) => {
    const url = firstImage(product.images);
    if (url) byProduct.set(String(product._id), url);
  });
  const bySku = new Map();
  masters.forEach((master) => {
    const url = byProduct.get(String(master.productId));
    if (url && master.code) bySku.set(String(master.code).trim().toLowerCase(), url);
  });
  return bySku;
}

function withImage(row, bySku) {
  if (!row || row.imageUrl) return row;
  const url = bySku.get(String(row.sku || row.code || '').trim().toLowerCase());
  return url ? { ...row, imageUrl: url } : row;
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

module.exports = { firstImage, imagesBySku, withImage, paintOrder };
