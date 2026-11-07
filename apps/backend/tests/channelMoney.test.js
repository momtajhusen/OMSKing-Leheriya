process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const amazon = require('../src/adapters/amazon');
const { mapShopifyOrder } = require('../src/adapters/shopify');
const channelConnection = require('../src/services/channelConnection.service');
const channelOrder = require('../src/services/channelOrder.service');
const { mapMyntraOrder, upsertMappedOrder } = require('../src/services/myntraSync.service');

const creds = { apiMode: 'sandbox', sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's' };
let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

async function tenant() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return Tenant.create({ name: 'Money', slug: `money-${stamp}`, kind: 'merchant' });
}

function amazonPull(orders, itemReplies) {
  const replies = [
    { status: 200, text: JSON.stringify({ access_token: 'token' }) },
    { status: 200, text: JSON.stringify({ payload: { Orders: orders } }) },
    ...itemReplies,
  ];
  return amazon.pullOrders(creds, { request: async () => replies.shift() || { status: 500, text: '{}' } });
}

const itemsReply = (OrderItems) => ({ status: 200, text: JSON.stringify({ payload: { OrderItems } }) });

async function amazonSync(pulled, claim) {
  const saved = [];
  const original = {
    getConnection: channelConnection.getConnection,
    credsOf: channelConnection.credsOf,
    claimChannelOrder: channelOrder.claimChannelOrder,
    finishChannelOrder: channelOrder.finishChannelOrder,
    pullOrders: amazon.pullOrders,
  };
  channelConnection.getConnection = async () => ({});
  channelConnection.credsOf = () => creds;
  channelOrder.claimChannelOrder = async (_key, next) => {
    if (claim) return claim(next);
    saved.push(next);
    return { doc: next, created: true };
  };
  channelOrder.finishChannelOrder = async (_tenantId, doc) => { if (claim) saved.push(doc); return 'created'; };
  amazon.pullOrders = async () => pulled;
  try {
    delete require.cache[require.resolve('../src/services/amazonSync.service')];
    const { pullAmazonOrders } = require('../src/services/amazonSync.service');
    await pullAmazonOrders(new mongoose.Types.ObjectId());
  } finally {
    Object.assign(channelConnection, { getConnection: original.getConnection, credsOf: original.credsOf });
    Object.assign(channelOrder, { claimChannelOrder: original.claimChannelOrder, finishChannelOrder: original.finishChannelOrder });
    amazon.pullOrders = original.pullOrders;
    delete require.cache[require.resolve('../src/services/amazonSync.service')];
  }
  return saved;
}

test('Amazon ItemPrice is the line total: unit price = (ItemPrice - PromotionDiscount) / qty, shipping into shippingCharge', async () => {
  const [row] = await amazonPull(
    [{ AmazonOrderId: '403-1', OrderStatus: 'Unshipped', OrderTotal: { Amount: '2950', CurrencyCode: 'INR' }, NumberOfItemsUnshipped: 5 }],
    [itemsReply([
      { SellerSKU: 'A1', Title: 'Kurta', QuantityOrdered: 2, ItemPrice: { Amount: '2000' }, PromotionDiscount: { Amount: '100' }, ShippingPrice: { Amount: '60' }, ShippingDiscount: { Amount: '20' } },
      { SellerSKU: 'A2', Title: 'Dupatta', QuantityOrdered: 3, ItemPrice: { Amount: '1000' }, ShippingPrice: { Amount: '10' } },
    ])],
  );
  assert.deepEqual(row.items.map(({ sku, qty, price }) => ({ sku, qty, price })), [
    { sku: 'A1', qty: 2, price: 950 },
    { sku: 'A2', qty: 3, price: 333.33 },
  ]);
  assert.equal(row.shippingCharge, 50);
  assert.equal(row.total, 2950);
});

test('Amazon fallback line (items throttled) keeps price * qty equal to OrderTotal', async () => {
  const rows = await amazonPull(
    [
      { AmazonOrderId: '403-2', OrderStatus: 'Unshipped', OrderTotal: { Amount: '1500' }, NumberOfItemsUnshipped: 3 },
      { AmazonOrderId: '403-3', OrderStatus: 'Unshipped', OrderTotal: { Amount: '1000' }, NumberOfItemsUnshipped: 3 },
    ],
    [{ status: 429, text: '{}' }],
  );
  assert.equal(rows[0].itemsKnown, false);
  assert.deepEqual([rows[0].items[0].qty, rows[0].items[0].price], [3, 500]);
  assert.deepEqual([rows[1].items[0].qty, rows[1].items[0].price], [3, 333.33]);
});

test('Amazon COD orders map to COD and carry the order currency into the saved order', async () => {
  const rows = await amazonPull(
    [
      { AmazonOrderId: '403-4', OrderStatus: 'Unshipped', OrderTotal: { Amount: '500', CurrencyCode: 'INR' }, NumberOfItemsUnshipped: 1, PaymentMethod: 'COD' },
      { AmazonOrderId: '403-5', OrderStatus: 'Unshipped', OrderTotal: { Amount: '500', CurrencyCode: 'INR' }, NumberOfItemsUnshipped: 1, PaymentMethod: 'Other', PaymentMethodDetails: ['CashOnDelivery'] },
      { AmazonOrderId: '403-6', OrderStatus: 'Unshipped', OrderTotal: { Amount: '500', CurrencyCode: 'USD' }, NumberOfItemsUnshipped: 1, PaymentMethod: 'Other', PaymentMethodDetails: ['Standard'] },
    ],
    [],
  );
  assert.deepEqual(rows.map((r) => r.paymentMode), ['COD', 'COD', 'Prepaid']);
  assert.deepEqual(rows.map((r) => r.currency), ['INR', 'INR', 'USD']);
  const saved = await amazonSync(rows.map((r) => ({ ...r, shippingCharge: 40 })));
  assert.deepEqual(saved.map((o) => o.paymentMode), ['COD', 'COD', 'Prepaid']);
  assert.deepEqual(saved.map((o) => o.currency), ['INR', 'INR', 'USD']);
  assert.equal(saved[0].shippingCharge, 40);
});

test('Amazon Pending order without OrderTotal takes its total from the items', async () => {
  const [row] = await amazonPull(
    [{ AmazonOrderId: '403-7', OrderStatus: 'Pending', NumberOfItemsUnshipped: 2 }],
    [itemsReply([{ SellerSKU: 'P1', QuantityOrdered: 2, ItemPrice: { Amount: '1200' }, ShippingPrice: { Amount: '50' } }])],
  );
  assert.equal(row.items[0].price, 600);
  assert.equal(row.total, 1250);
});

test('Amazon resync with a zero total keeps the saved non-zero total', async () => {
  const doc = { status: 'New', total: 1250, items: [{ sku: 'P1', qty: 2, price: 600 }], subOrders: [], channelLines: [] };
  const [saved] = await amazonSync(
    [{ externalOrderId: '403-7', status: 'New', total: 0, itemsKnown: false, items: [{ name: 'Amazon Pending', sku: '403-7', qty: 2, price: 0 }] }],
    async () => ({ doc, created: false }),
  );
  assert.equal(saved.total, 1250);
});

test('Amazon resync after AWB keeps the total and records the channel change', async () => {
  const doc = { status: 'Ready to Ship', total: 1000, awb: 'AWB-1', items: [], subOrders: [], channelLines: [] };
  const [saved] = await amazonSync(
    [{ externalOrderId: '403-8', status: 'Ready to Ship', total: 1200, itemsKnown: false, items: [{ sku: '403-8', qty: 1, price: 1200 }] }],
    async () => ({ doc, created: false }),
  );
  assert.equal(saved.total, 1000);
  assert.equal(saved.totalChangedAfterLock.from, 1000);
  assert.equal(saved.totalChangedAfterLock.to, 1200);
  assert.ok(saved.totalChangedAfterLock.at instanceof Date);
});

function shopifyOrder(extra = {}) {
  return {
    id: 9001,
    name: '#9001',
    currency: 'INR',
    total_price: '1048.40',
    financial_status: 'paid',
    created_at: '2026-11-01T10:00:00Z',
    line_items: [{
      sku: 'S1', title: 'Saree', quantity: 2, current_quantity: 2, price: '500.00',
      discount_allocations: [{ amount: '100.00' }], tax_lines: [{ price: '54.00' }],
    }],
    shipping_lines: [{ price: '100.00', discounted_price: '80.00', tax_lines: [{ price: '14.40' }] }],
    ...extra,
  };
}

test('Shopify line price is after discount; taxes are added when taxes_included is false; shipping and currency mapped', () => {
  const excl = mapShopifyOrder(shopifyOrder({ taxes_included: false }), {});
  assert.equal(excl.items[0].price, 477);
  assert.equal(excl.shippingCharge, 94.4);
  assert.equal(excl.currency, 'INR');
  const incl = mapShopifyOrder(shopifyOrder({ taxes_included: true }), {});
  assert.equal(incl.items[0].price, 450);
  assert.equal(incl.shippingCharge, 80);
  const odd = mapShopifyOrder(shopifyOrder({
    taxes_included: true,
    line_items: [{ sku: 'S2', quantity: 3, current_quantity: 3, price: '333.33', discount_allocations: [{ amount: '10.00' }] }],
  }), {});
  assert.equal(odd.items[0].price, 330);
  const edited = mapShopifyOrder(shopifyOrder({
    taxes_included: true,
    line_items: [{ sku: 'S3', quantity: 2, current_quantity: 1, price: '500.00', discount_allocations: [{ amount: '100.00' }] }],
  }), {});
  assert.deepEqual([edited.items[0].qty, edited.items[0].price], [1, 450], 'discount covers the 2 ordered units, not the 1 left');
});

test('Shopify total uses current_total_price (after edits/refunds) when present', () => {
  assert.equal(mapShopifyOrder(shopifyOrder({ current_total_price: '524.20' }), {}).total, 524.2);
  assert.equal(mapShopifyOrder(shopifyOrder(), {}).total, 1048.4);
});

test('Shopify partially paid order sets codAmount to total_outstanding; plain COD leaves it null', () => {
  const part = mapShopifyOrder(shopifyOrder({ financial_status: 'partially_paid', total_outstanding: '300.00' }), {});
  assert.equal(part.codAmount, 300);
  const cod = mapShopifyOrder(shopifyOrder({ financial_status: 'pending', payment_gateway_names: ['Cash on Delivery (COD)'] }), {});
  assert.equal(cod.paymentMode, 'COD');
  assert.equal(cod.codAmount, null);
});

test('channel ingest saves codAmount, shippingCharge and currency on the order', async () => {
  const t = await tenant();
  const mapped = mapShopifyOrder(shopifyOrder({ id: 9101, taxes_included: false, financial_status: 'partially_paid', total_outstanding: '300.00' }), {});
  await channelOrder.ingestChannelOrders(t._id, 'shopify', [mapped]);
  const saved = await Order.findOne({ tenantId: t._id, externalOrderId: '9101' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(saved.codAmount, 300);
  assert.equal(saved.shippingCharge, 94.4);
  assert.equal(saved.currency, 'INR');
});

test('channel resync after invoice keeps the total and records totalChangedAfterLock', async () => {
  const t = await tenant();
  await channelOrder.ingestChannelOrders(t._id, 'shopify', [{ externalOrderId: 'L1', status: 'New', total: 1000, items: [{ sku: 'X1', qty: 1, price: 1000 }] }]);
  await Order.updateOne({ tenantId: t._id, externalOrderId: 'L1' }, { $set: { invoiceGeneratedAt: new Date() } }).setOptions({ skipTenantFilter: true });
  await channelOrder.ingestChannelOrders(t._id, 'shopify', [{ externalOrderId: 'L1', status: 'New', total: 1500, items: [{ sku: 'X1', qty: 1, price: 1500 }] }]);
  const saved = await Order.findOne({ tenantId: t._id, externalOrderId: 'L1' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(saved.total, 1000);
  assert.equal(saved.totalChangedAfterLock.from, 1000);
  assert.equal(saved.totalChangedAfterLock.to, 1500);

  await channelOrder.ingestChannelOrders(t._id, 'shopify', [{ externalOrderId: 'L2', status: 'New', total: 1000, items: [{ sku: 'X1', qty: 1, price: 1000 }] }]);
  await channelOrder.ingestChannelOrders(t._id, 'shopify', [{ externalOrderId: 'L2', status: 'New', total: 1500, items: [{ sku: 'X1', qty: 1, price: 1500 }] }]);
  const open = await Order.findOne({ tenantId: t._id, externalOrderId: 'L2' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(open.total, 1500, 'no invoice/AWB yet: total follows the channel');
});

function myntraDetail(sellerOrderId, lines) {
  return {
    sellerOrderId,
    receiverName: 'Buyer',
    paymentMethod: 'cod',
    orderLineEntries: lines.map((l, i) => ({
      orderLineId: `${sellerOrderId}-L${i}`, sku: l.sku, quantity: l.qty || 1, mrp: 2000,
      lineFinalAmount: l.amount, status_code: l.status || 'WP', createdOn: '05-10-2026 10:15:00',
    })),
  };
}

test('Myntra total is sum(price * qty) over lines that are not cancelled', () => {
  const mapped = mapMyntraOrder('M-1', [myntraDetail('S-1', [
    { sku: 'A', qty: 2, amount: 500 },
    { sku: 'B', qty: 1, amount: 300, status: 'IC' },
  ])]);
  assert.equal(mapped.items[0].price, 500);
  assert.equal(mapped.total, 1000);
});

test('Myntra lineFinalAmount above MRP with qty > 1 is a line total, so the unit price is amount / qty', () => {
  const mapped = mapMyntraOrder('M-3', [myntraDetail('S-3', [
    { sku: 'A', qty: 2, amount: 3000 },
    { sku: 'B', qty: 2, amount: 500 },
  ])]);
  assert.equal(mapped.items[0].price, 1500, 'a unit cannot sell above MRP 2000, so 3000 covers both units');
  assert.equal(mapped.items[1].price, 500, 'at or below MRP it stays a unit price');
  assert.equal(mapped.total, 4000);
});

test('Myntra line with no selling price falls back to MRP and is flagged', () => {
  const mapped = mapMyntraOrder('M-4', [{
    sellerOrderId: 'S-4',
    paymentMethod: 'cod',
    orderLineEntries: [{ orderLineId: 'S-4-L0', sku: 'A', quantity: 1, mrp: 2000, status_code: 'WP', createdOn: '05-10-2026 10:15:00' }],
  }]);
  assert.equal(mapped.items[0].price, 2000);
  assert.equal(mapped.items[0].priceFromMrp, true);
  const priced = mapMyntraOrder('M-5', [myntraDetail('S-5', [{ sku: 'A', qty: 1, amount: 900 }])]);
  assert.equal(priced.items[0].priceFromMrp, false);
});

test('merged Myntra seller orders recompute the order total from the merged lines', async () => {
  const t = await tenant();
  await upsertMappedOrder(t._id, mapMyntraOrder('M-2', [myntraDetail('S-21', [{ sku: 'A', qty: 2, amount: 500 }])]));
  await upsertMappedOrder(t._id, mapMyntraOrder('M-2', [myntraDetail('S-22', [{ sku: 'B', qty: 1, amount: 300 }])]));
  const merged = await Order.findOne({ tenantId: t._id, orderNo: 'MYN-M-2' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(merged.total, 1300);
  await upsertMappedOrder(t._id, mapMyntraOrder('M-2', [myntraDetail('S-22', [{ sku: 'B', qty: 1, amount: 300, status: 'F' }])]));
  const cancelled = await Order.findOne({ tenantId: t._id, orderNo: 'MYN-M-2' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(cancelled.total, 1000);
});
