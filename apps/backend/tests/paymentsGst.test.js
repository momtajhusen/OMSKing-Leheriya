process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { upsertConnection } = require('../src/services/channelConnection.service');
const { ensureDefaultWarehouses } = require('../src/services/warehouse.service');
const { stockIn } = require('../src/services/inventory.service');
const { applyTracking } = require('../src/services/tracking.service');
const { requeueJob, processDueJobs } = require('../src/services/jobQueue.service');
const finance = require('../src/services/finance.service');
const Order = require('../src/models/Order');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const Warehouse = require('../src/models/Warehouse');
const Inventory = require('../src/models/Inventory');
const InventoryReservation = require('../src/models/InventoryReservation');
const InventoryLedger = require('../src/models/InventoryLedger');
const IntegrationJob = require('../src/models/IntegrationJob');
const shopify = require('../src/adapters/shopify');

let replSet;
let server;
let base;

function paise(value) {
  return Math.round(Number(value) * 100);
}

function cookieHeader(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const raw = list.length ? list : [res.headers.get('set-cookie')].filter(Boolean);
  return raw.map((row) => String(row).split(';')[0]).join('; ');
}

async function api(method, path, { token, json } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  return { status: res.status, body, cookie: cookieHeader(res) };
}

async function login(email) {
  const res = await api('POST', '/api/v1/auth/login', {
    json: { email, password: 'Password1' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken;
}

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

test('GST lines add up in paise and a Shopify invoice number is the channel order id', () => {
  const tax = finance.lineTax(
    { price: 10, qty: 3, gst: 5 },
    { warehouseState: 'Rajasthan', shipState: 'Rajasthan' },
  );
  assert.equal(tax.igst, 0);
  assert.equal(
    paise(tax.taxable) + paise(tax.cgst) + paise(tax.sgst) + paise(tax.igst),
    paise(tax.gross),
  );
  assert.equal(paise(tax.gross), 3000);
  [tax.gross, tax.taxable, tax.cgst, tax.sgst, tax.igst].forEach((amount) => {
    assert.equal(paise(amount) / 100, amount);
  });

  const order = { channel: 'Shopify', orderNo: 'SHP-4401', externalOrderId: '4401', invoiceNo: 'INV-STALE' };
  assert.equal(finance.invoiceNumber(order), '4401');
  assert.equal(finance.creditNoteNumber(order), 'CN-4401');
});

test('a delivered Shopify COD order stays partially paid until it is marked paid', async () => {
  const shop = await provisionMerchant({
    name: 'COD shop',
    ownerEmail: `cod-${Date.now()}@example.com`,
    ownerName: 'COD Owner',
    password: 'Password1',
    status: 'active',
  });
  await Order.create({
    tenantId: shop.tenant._id,
    orderNo: 'SHP-COD-1',
    channel: 'Shopify',
    status: 'Dispatched',
    paymentMode: 'COD',
    paymentStatus: '',
    externalOrderId: '4401',
    invoiceNo: 'INV-STALE',
    awb: 'AWB-COD-1',
    total: 118,
    email: '',
    items: [{ name: 'Kurta', sku: 'KURTA', qty: 1, price: 118, gst: 18 }],
    source: 'manual',
  });
  await applyTracking(shop.tenant._id, {
    orderNo: 'SHP-COD-1',
    awb: 'AWB-COD-1',
    status: 'delivered',
    eventKey: 'delivered-1',
  });
  const token = await login(shop.owner.email);
  const listed = await api('GET', '/api/v1/orders?limit=50', { token });
  assert.equal(listed.status, 200);
  const row = listed.body.data.find((order) => order.orderNo === 'SHP-COD-1');
  assert.equal(row.status, 'Delivered');
  assert.equal(row.paymentLabel, 'Partially paid');
  assert.equal(row.paid, false);
  assert.notEqual(row.paymentStatus, 'paid');

  const marked = await api('POST', '/api/v1/orders/SHP-COD-1/payment', { token, json: {} });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.equal(marked.body.data.paymentLabel, 'Paid');
  assert.equal(marked.body.data.paid, true);
  assert.equal(marked.body.data.paymentStatus, 'paid');

  const invoice = await api('POST', '/api/v1/orders/SHP-COD-1/invoice', { token, json: { email: false } });
  assert.equal(invoice.status, 200, JSON.stringify(invoice.body));
  assert.equal(invoice.body.data.invoiceNo, '4401');
  assert.match(invoice.body.data.invoiceHtml, /Tax invoice 4401/);
  assert.equal(invoice.body.data.invoiceHtml.includes('INV-STALE'), false);
  const pdf = Buffer.from(invoice.body.data.invoicePdf, 'base64').toString('latin1');
  assert.match(pdf, /Tax invoice 4401/);
  assert.equal(pdf.includes('INV-STALE'), false);
});

test('reports and settlement totals stay on the caller company', async () => {
  const alpha = await provisionMerchant({
    name: 'Alpha reports',
    ownerEmail: `alpha-${Date.now()}@example.com`,
    ownerName: 'Alpha',
    password: 'Password1',
    status: 'active',
  });
  const beta = await provisionMerchant({
    name: 'Beta reports',
    ownerEmail: `beta-${Date.now()}@example.com`,
    ownerName: 'Beta',
    password: 'Password1',
    status: 'active',
  });
  await Order.create({
    tenantId: alpha.tenant._id,
    orderNo: 'ALP-1',
    channel: 'Shopify',
    status: 'Delivered',
    paymentMode: 'Prepaid',
    total: 111,
    items: [{ name: 'Alpha kurta', sku: 'ALPHA-SKU', qty: 1, price: 111 }],
    source: 'manual',
  });
  await Order.create({
    tenantId: beta.tenant._id,
    orderNo: 'BET-1',
    channel: 'Shopify',
    status: 'Delivered',
    paymentMode: 'Prepaid',
    total: 999,
    externalOrderId: 'BET-EXT',
    items: [{ name: 'Beta kurta', sku: 'BETA-SKU', qty: 1, price: 999 }],
    source: 'manual',
  });
  await ensureDefaultWarehouses(alpha.tenant._id);
  await ensureDefaultWarehouses(beta.tenant._id);
  const alphaSku = await MasterSku.create({ tenantId: alpha.tenant._id, code: 'ALPHA-SKU', name: 'Alpha', costPrice: 10 });
  const betaSku = await MasterSku.create({ tenantId: beta.tenant._id, code: 'BETA-SKU', name: 'Beta', costPrice: 20 });
  const alphaWh = await Warehouse.findOne({ tenantId: alpha.tenant._id, code: 'WH-001' });
  const betaWh = await Warehouse.findOne({ tenantId: beta.tenant._id, code: 'WH-001' });
  await stockIn(String(alpha.tenant._id), null, { masterSkuId: alphaSku._id, warehouseId: alphaWh._id, qty: 2, reason: 'opening' });
  await stockIn(String(beta.tenant._id), null, { masterSkuId: betaSku._id, warehouseId: betaWh._id, qty: 4, reason: 'opening' });

  const token = await login(alpha.owner.email);
  const orders = await api('GET', '/api/v1/orders?limit=50', { token });
  assert.equal(orders.status, 200);
  const packed = JSON.stringify(orders.body);
  assert.equal(packed.includes('BET-1'), false);
  assert.equal(packed.includes('BETA-SKU'), false);
  assert.equal(packed.includes('999'), false);
  const sales = orders.body.data
    .filter((order) => order.status !== 'Cancelled')
    .reduce((sum, order) => sum + paise(order.total), 0);
  assert.equal(sales, 11100);

  const stock = await api('GET', '/api/v1/inventory?limit=50', { token });
  assert.equal(stock.status, 200);
  const stockPacked = JSON.stringify(stock.body);
  assert.equal(stockPacked.includes('BETA-SKU'), false);
  assert.equal(stockPacked.includes('Alpha'), true);
  const value = (stock.body.data.rows || []).reduce((sum, row) => sum + paise(row.cost) * (Number(row.stock) || 0), 0);
  assert.equal(value, 2000);

  const settlement = await api('POST', '/api/v1/finance/settlements', {
    token,
    json: {
      source: 'amazon',
      csv: [
        'order,gross,commission,shipping,fees,tcs,tds,refunds,net',
        'ALP-1,111,0,0,0,0,0,0,111',
        'BET-1,999,0,0,0,0,0,0,999',
      ].join('\n'),
    },
  });
  assert.equal(settlement.status, 200, JSON.stringify(settlement.body));
  const rows = settlement.body.data.rows;
  assert.equal(rows.find((row) => row.orderNo === 'ALP-1').status, 'matched');
  const foreign = rows.find((row) => row.key === 'BET-1');
  assert.equal(foreign.status, 'exception');
  assert.equal(foreign.orderNo, undefined);
  assert.match(foreign.exception, /No Master Order/);
});

test('retrying an integrations order pull does not reserve a second piece', async () => {
  const shop = await provisionMerchant({
    name: 'Retry shop',
    ownerEmail: `retry-${Date.now()}@example.com`,
    ownerName: 'Retry',
    password: 'Password1',
    status: 'active',
  });
  await ensureDefaultWarehouses(shop.tenant._id);
  const sku = await MasterSku.create({ tenantId: shop.tenant._id, code: 'KURTA-PAY', name: 'Kurta' });
  await SkuMapping.create({
    tenantId: shop.tenant._id,
    masterSkuId: sku._id,
    channel: 'shopify',
    channelProductId: 'p',
    channelVariantId: 'v',
    channelSkuCode: 'KURTA-PAY',
    channelSkuCodeNorm: 'kurta-pay',
    syncStatus: 'synced',
  });
  const warehouse = await Warehouse.findOne({ tenantId: shop.tenant._id, code: 'WH-001' });
  await stockIn(String(shop.tenant._id), null, { masterSkuId: sku._id, warehouseId: warehouse._id, qty: 5, reason: 'opening' });
  await upsertConnection(shop.tenant._id, null, 'shopify', {
    credentials: { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' },
  });
  const original = shopify.pullOrders;
  let pulls = 0;
  shopify.pullOrders = async () => {
    pulls += 1;
    return [{
      externalOrderId: '8801',
      status: 'New',
      paymentMode: 'COD',
      total: 100,
      items: [{ sku: 'KURTA-PAY', name: 'Kurta', qty: 1, price: 100 }],
    }];
  };
  try {
    const job = await IntegrationJob.create({
      tenantId: shop.tenant._id,
      channel: 'shopify',
      jobType: 'orders_pull',
      status: 'queued',
      direction: 'pull',
      triggeredBy: 'manual',
    });
    await processDueJobs({ limit: 5 });
    const held = () => InventoryReservation.find({ tenantId: shop.tenant._id, status: 'held' }).setOptions({ skipTenantFilter: true });
    const first = await held();
    assert.equal(first.length, 1);
    assert.equal(first[0].qty, 1);
    const balance = await Inventory.findOne({ tenantId: shop.tenant._id, masterSkuId: sku._id });
    assert.equal(balance.reservedQty, 1);

    await IntegrationJob.updateOne({ _id: job._id }, { $set: { status: 'failed', lastError: 'pull failed' } }).setOptions({ skipTenantFilter: true });
    await requeueJob(shop.tenant._id, null, job._id);
    await processDueJobs({ limit: 5 });

    const second = await held();
    assert.equal(second.length, 1);
    assert.equal(second[0].qty, 1);
    const again = await Inventory.findOne({ tenantId: shop.tenant._id, masterSkuId: sku._id });
    assert.equal(again.reservedQty, 1);
    assert.equal(again.physicalQty, 5);
    const reserved = await InventoryLedger.find({ tenantId: shop.tenant._id, movementType: 'order_reserve' }).setOptions({ skipTenantFilter: true });
    const released = await InventoryLedger.find({ tenantId: shop.tenant._id, movementType: 'order_release' }).setOptions({ skipTenantFilter: true });
    assert.equal(reserved.length, 1);
    assert.equal(released.length, 0);
    assert.equal(pulls >= 1, true);
  } finally {
    shopify.pullOrders = original;
  }
});
