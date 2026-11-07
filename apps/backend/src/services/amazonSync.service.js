const { getConnection, credsOf } = require('./channelConnection.service');
const amazon = require('../adapters/amazon');
const { withSubOrders } = require('../lib/orderSubOrders');
const { HttpError } = require('../utils/httpError');
const { claimChannelOrder, finishChannelOrder, applyChannelTotal, moneyLocked } = require('./channelOrder.service');
const MasterSku = require('../models/MasterSku');
const Product = require('../models/Product');
const SkuMapping = require('../models/SkuMapping');
const { firstImage } = require('../lib/catalogImages');

/** Amazon seller SKU -> master SKU; shows the Shopify SKU and the Amazon photo, else the Shopify photo. */
async function withCatalog(tenantId, items) {
  const skus = [...new Set(items.map((item) => String(item.sku || '')).filter(Boolean))];
  if (!skus.length) return items;
  const opts = { skipTenantFilter: true };
  const [maps, byCode] = await Promise.all([
    SkuMapping.find({
      tenantId,
      channel: { $in: ['amazon', 'shopify'] },
      isActive: { $ne: false },
      masterSkuId: { $ne: null },
      $or: [{ channelSkuCode: { $in: skus } }, { channelVariantId: { $in: skus } }],
    }).setOptions(opts).lean(),
    MasterSku.find({ tenantId, code: { $in: skus.map((sku) => sku.toUpperCase()) } }).setOptions(opts).lean(),
  ]);
  const amazonBySku = new Map();
  const shopifyBySku = new Map();
  maps.forEach((m) => {
    const into = m.channel === 'amazon' ? amazonBySku : shopifyBySku;
    [m.channelSkuCode, m.channelVariantId].filter(Boolean).forEach((key) => { if (!into.has(key)) into.set(key, m); });
  });
  const masterIdOf = (sku) => amazonBySku.get(sku)?.masterSkuId
    || shopifyBySku.get(sku)?.masterSkuId
    || byCode.find((m) => m.code === sku.toUpperCase())?._id;
  const ids = [...new Set(skus.map(masterIdOf).filter(Boolean).map(String))];
  if (!ids.length) return items;
  const [masters, shopifyMaps] = await Promise.all([
    MasterSku.find({ tenantId, _id: { $in: ids } }).setOptions(opts).lean(),
    SkuMapping.find({ tenantId, channel: 'shopify', isActive: { $ne: false }, masterSkuId: { $in: ids } }).setOptions(opts).lean(),
  ]);
  const productIds = masters.map((m) => m.productId).filter(Boolean);
  const products = productIds.length
    ? await Product.find({ tenantId, _id: { $in: productIds } }).select('images').setOptions(opts).lean()
    : [];
  const masterById = new Map(masters.map((m) => [String(m._id), m]));
  const shopifyByMaster = new Map(shopifyMaps.map((m) => [String(m.masterSkuId), m]));
  const imageByProduct = new Map(products.map((p) => [String(p._id), firstImage(p.images)]));
  return items.map((item) => {
    const sku = String(item.sku || '');
    const masterId = sku && masterIdOf(sku);
    const master = masterId && masterById.get(String(masterId));
    if (!master) return item;
    const amazonMap = amazonBySku.get(sku);
    const shop = shopifyByMaster.get(String(master._id));
    return {
      ...item,
      name: master.name || item.name,
      sku: shop?.channelSkuCode || master.code || sku,
      masterSkuId: master._id,
      skuMappingId: amazonMap?._id || null,
      imageUrl: amazonMap?.imageUrl || shop?.imageUrl || imageByProduct.get(String(master.productId)) || item.imageUrl || '',
    };
  });
}

async function pullAmazonOrders(tenantId, { skipExternalIds = [], afterEach } = {}) {
  const row = await getConnection(tenantId, 'amazon');
  if (!row) throw new HttpError(400, 'Amazon is not connected for this workspace');
  const creds = credsOf(row);
  const fetched = await amazon.pullOrders(creds);
  const skip = new Set((skipExternalIds || []).map((id) => String(id)));
  const out = { fetched: fetched.length, created: 0, updated: 0, unchanged: 0 };
  for (const order of fetched) {
    const externalOrderId = String(order.externalOrderId || '');
    if (externalOrderId && skip.has(externalOrderId)) {
      out.unchanged += 1;
      continue;
    }
    const orderNo = `AMZ-${order.externalOrderId}`;
    const next = withSubOrders({
      tenantId,
      orderNo,
      channel: 'Amazon',
      status: order.status,
      paymentMode: order.paymentMode || 'Prepaid',
      fulfilmentSource: 'Offline',
      items: order.itemsKnown ? await withCatalog(tenantId, order.items) : order.items,
      total: order.total,
      shippingCharge: Number(order.shippingCharge) || 0,
      currency: order.currency || 'INR',
      orderDate: order.orderDate,
      source: 'channel_api',
      externalOrderId: order.externalOrderId,
      channelLines: order.shipByTime ? [{ sellerOrderId: order.externalOrderId, shipByTime: order.shipByTime }] : [],
      customer: '',
      email: '',
      phone: '',
      address: '',
    });
    const { doc, created } = await claimChannelOrder(
      { tenantId, channel: 'Amazon', externalOrderId: order.externalOrderId },
      next,
    );
    let before = null;
    if (!created) {
      before = `${doc.status}|${doc.total}`;
      require('./orderReserve.service').mergeChannelStatus(doc, next.status);
      if (order.itemsKnown && !moneyLocked(doc)) doc.shippingCharge = next.shippingCharge;
      applyChannelTotal(doc, Number(next.total) || doc.total);
      if (order.paymentMode) doc.paymentMode = order.paymentMode;
      if (order.currency) doc.currency = order.currency;
      if (order.itemsKnown !== false || !(doc.items || []).length) {
        doc.items = next.items;
        doc.subOrders = next.subOrders;
      }
      doc.orderDate = next.orderDate || doc.orderDate;
      if (next.channelLines.length) doc.channelLines = next.channelLines;
      doc.source = 'channel_api';
      if (next.reserveState !== undefined) doc.reserveState = next.reserveState;
    }
    const outcome = await finishChannelOrder(tenantId, doc, {
      created,
      before,
      orderNo,
      channelName: 'Amazon',
    });
    out[outcome] += 1;
    if (afterEach && externalOrderId) await afterEach(externalOrderId);
  }
  return out;
}

module.exports = { pullAmazonOrders };
