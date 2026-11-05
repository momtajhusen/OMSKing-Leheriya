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
  assert.match(pdf, /Tax Invoice/);
  assert.match(pdf, /Invoice No: 4401/);
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
  const paidOwn = await Order.findOne({ tenantId: alpha.tenant._id, orderNo: 'ALP-1' }).setOptions({ skipTenantFilter: true }).lean();
  const otherTenant = await Order.findOne({ tenantId: beta.tenant._id, orderNo: 'BET-1' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(paidOwn.paymentStatus, 'paid');
  assert.notEqual(otherTenant.paymentStatus, 'paid');
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

test('a Shopify invoice uses the Shopify order number and the SKU GST rate, and a GSTIN from another state is refused', async () => {
  assert.equal(finance.invoiceNumber({ channel: 'Shopify', channelOrderNo: '#68762-LEH', externalOrderId: '19028924072029' }), '68762-LEH');

  const shop = await provisionMerchant({
    name: 'Invoice shop',
    ownerEmail: `inv-${Date.now()}@example.com`,
    ownerName: 'Invoice Owner',
    password: 'Password1',
    status: 'active',
  });
  const tenantId = shop.tenant._id;
  await ensureDefaultWarehouses(tenantId);
  await Warehouse.updateOne(
    { tenantId, code: 'WH-001' },
    { $set: { 'address.state': 'Rajasthan', 'address.city': 'Jaipur' } },
  ).setOptions({ skipTenantFilter: true });
  const sku = await MasterSku.create({ tenantId, code: 'LEHKCPC113', name: 'Bandhani Dupatta', hsnCode: '620443', gstRatePercent: 5 });
  await Order.create({
    tenantId,
    orderNo: 'SHP-19028924072029',
    channel: 'Shopify',
    externalOrderId: '19028924072029',
    channelOrderNo: '#68762-LEH',
    status: 'Dispatched',
    shipState: 'Delhi',
    customer: 'Pamela Anand',
    total: 2799,
    items: [{ name: 'Bandhani Dupatta', sku: 'LEHKCPC113', qty: 1, price: 2799, gst: 0, hsn: '', masterSkuId: sku._id }],
    source: 'channel_api',
  });
  const token = await login(shop.owner.email);

  shop.tenant.legalEntity = { ...(shop.tenant.legalEntity || {}), gstin: '27AAPFU0939G1ZV' };
  shop.tenant.markModified('legalEntity');
  await shop.tenant.save();
  const refused = await api('POST', '/api/v1/orders/SHP-19028924072029/invoice', { token, json: { email: false } });
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.match(refused.body.message, /Maharashtra/);
  assert.match(refused.body.message, /Rajasthan/);

  shop.tenant.legalEntity = { ...(shop.tenant.legalEntity || {}), gstin: '08AAPFU0939G1ZV' };
  shop.tenant.markModified('legalEntity');
  await shop.tenant.save();
  const invoice = await api('POST', '/api/v1/orders/SHP-19028924072029/invoice', { token, json: { email: false } });
  assert.equal(invoice.status, 200, JSON.stringify(invoice.body));
  assert.equal(invoice.body.data.invoiceNo, '68762-LEH');
  const pdf = Buffer.from(invoice.body.data.invoicePdf, 'base64').toString('latin1');
  assert.match(pdf, /Invoice No: 68762-LEH/);
  assert.match(pdf, /Order Id: 68762-LEH/);
  assert.equal(pdf.includes('SHP-19028924072029'), false);
  assert.match(pdf, /Total Amount before Tax:\) Tj ET\n.*\(Rs\. 2665\.71\)/);
  assert.match(pdf, /Total IGST:\) Tj ET\n.*\(Rs\. 133\.29\)/);
  assert.match(invoice.body.data.invoiceHtml, /Tax invoice 68762-LEH/);
  assert.match(invoice.body.data.invoiceHtml, /620443/);
  const saved = await Order.findOne({ tenantId, orderNo: 'SHP-19028924072029' }).setOptions({ skipTenantFilter: true });
  assert.equal(saved.items[0].gst, 5);
  assert.equal(saved.items[0].hsn, '620443');
});

test('the GSTIN saved in Company Details replaces the old one on the invoice header and supplier block', async () => {
  const shop = await provisionMerchant({
    name: 'GSTIN shop',
    ownerEmail: `gstin-${Date.now()}@example.com`,
    ownerName: 'GSTIN Owner',
    password: 'Password1',
    status: 'active',
  });
  const tenantId = shop.tenant._id;
  await ensureDefaultWarehouses(tenantId);
  await Warehouse.updateOne(
    { tenantId, code: 'WH-001' },
    { $set: { 'address.state': 'Delhi', 'address.city': 'New Delhi' } },
  ).setOptions({ skipTenantFilter: true });
  await Order.create({
    tenantId,
    orderNo: 'SHP-GSTIN-1',
    channel: 'Shopify',
    externalOrderId: '7001',
    channelOrderNo: '#7001-LEH',
    status: 'Dispatched',
    shipState: 'Delhi',
    customer: 'Delhi Buyer',
    total: 1050,
    items: [{ name: 'Dupatta', sku: 'D1', qty: 1, price: 1050, gst: 5, hsn: '5407' }],
    source: 'channel_api',
  });
  const token = await login(shop.owner.email);

  const old = await api('PATCH', '/api/v1/settings/company', { token, json: { gstin: '07ACCPD9873C1ZP' } });
  assert.equal(old.status, 200, JSON.stringify(old.body));
  const saved = await api('PATCH', '/api/v1/settings/company', { token, json: { gstin: ' 07aaqcp4784p1zb ' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const company = await api('GET', '/api/v1/settings/company', { token });
  assert.equal(company.body.data.gstin, '07AAQCP4784P1ZB');

  const invoice = await api('POST', '/api/v1/orders/SHP-GSTIN-1/invoice', { token, json: { email: false } });
  assert.equal(invoice.status, 200, JSON.stringify(invoice.body));
  const pdf = Buffer.from(invoice.body.data.invoicePdf, 'base64').toString('latin1');
  assert.equal(pdf.split('(GSTIN: 07AAQCP4784P1ZB)').length - 1, 2, 'header and supplier block both show the new GSTIN');
  assert.equal(pdf.includes('07ACCPD9873C1ZP'), false);
});

test('the supplier block shows the legal name from Company Details while the header keeps the store name', async () => {
  const shop = await provisionMerchant({
    name: 'Leheriya',
    ownerEmail: `supplier-${Date.now()}@example.com`,
    ownerName: 'Supplier Owner',
    password: 'Password1',
    status: 'active',
  });
  const tenantId = shop.tenant._id;
  await ensureDefaultWarehouses(tenantId);
  await Warehouse.updateOne(
    { tenantId, code: 'WH-001' },
    { $set: { 'address.state': 'Delhi', 'address.city': 'New Delhi' } },
  ).setOptions({ skipTenantFilter: true });
  await Order.create({
    tenantId,
    orderNo: 'SHP-SUPPLIER-1',
    channel: 'Shopify',
    externalOrderId: '7002',
    channelOrderNo: '#7002-LEH',
    status: 'Dispatched',
    shipState: 'Delhi',
    customer: 'Delhi Buyer',
    total: 1050,
    items: [{ name: 'Dupatta', sku: 'D1', qty: 1, price: 1050, gst: 5, hsn: '5407' }],
    source: 'channel_api',
  });
  const token = await login(shop.owner.email);

  const saved = await api('PATCH', '/api/v1/settings/company', {
    token,
    json: {
      legalName: ' PRDOSCO GLOBAL PRIVATE LIMITED ',
      gstin: '07AAQCP4784P1ZB',
      address: 'BASEMENT, PLOT NO 24, SECTOR 12-A ROAD',
      city: 'SECTOR 12, DWARKA-110078',
      district: '',
      supportEmail: 'support@leheriya.com',
      supportPhone: '+91 9873003388',
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const company = await api('GET', '/api/v1/settings/company', { token });
  assert.equal(company.body.data.legalName, 'PRDOSCO GLOBAL PRIVATE LIMITED');
  assert.equal(company.body.data.companyName, 'Leheriya');

  const invoice = await api('POST', '/api/v1/orders/SHP-SUPPLIER-1/invoice', { token, json: { email: false } });
  assert.equal(invoice.status, 200, JSON.stringify(invoice.body));
  const pdf = Buffer.from(invoice.body.data.invoicePdf, 'base64').toString('latin1');
  assert.ok(pdf.includes('(PRDOSCO GLOBAL PRIVATE LIMITED)'), 'supplier block shows the legal name');
  assert.ok(pdf.includes('(Leheriya)'), 'header keeps the store name');
  assert.ok(pdf.includes('(BASEMENT, PLOT NO 24, SECTOR 12-A ROAD)'));
  assert.ok(pdf.includes('(SECTOR 12, DWARKA-110078)'));
  assert.ok(pdf.includes('(Tel: +91 9873003388)'));
  assert.ok(pdf.includes('(Email: support@leheriya.com)'));
  assert.equal(pdf.split('(GSTIN: 07AAQCP4784P1ZB)').length - 1, 2);
});

test('billed to comes from the order customer and a B2B customer GSTIN can be added to the invoice', async () => {
  const shop = await provisionMerchant({
    name: 'B2B shop',
    ownerEmail: `b2b-${Date.now()}@example.com`,
    ownerName: 'B2B Owner',
    password: 'Password1',
    status: 'active',
  });
  const tenantId = shop.tenant._id;
  await ensureDefaultWarehouses(tenantId);
  await Warehouse.updateOne(
    { tenantId, code: 'WH-001' },
    { $set: { 'address.state': 'Delhi', 'address.city': 'New Delhi' } },
  ).setOptions({ skipTenantFilter: true });
  await Order.create({
    tenantId,
    orderNo: 'SHP-B2B-1',
    channel: 'Shopify',
    externalOrderId: '7003',
    channelOrderNo: '#7003-LEH',
    status: 'Dispatched',
    shipState: 'Delhi',
    customer: 'Indian Farmers Fertilizer Cooperative Limited',
    address: 'C-1, DISTRICT CENTRE, SAKET',
    city: 'NEW DELHI 110017',
    phone: '+911142592791',
    total: 1050,
    items: [{ name: 'Dupatta', sku: 'D1', qty: 1, price: 1050, gst: 5, hsn: '5407' }],
    source: 'channel_api',
  });
  const token = await login(shop.owner.email);

  const bad = await api('POST', '/api/v1/orders/SHP-B2B-1/invoice', { token, json: { email: false, customerGstin: 'NOT-A-GSTIN' } });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));

  const invoice = await api('POST', '/api/v1/orders/SHP-B2B-1/invoice', { token, json: { email: false, customerGstin: ' 07aaacd1234e1z5 ' } });
  assert.equal(invoice.status, 200, JSON.stringify(invoice.body));
  assert.equal(invoice.body.data.customerGstin, '07AAACD1234E1Z5');
  const pdf = Buffer.from(invoice.body.data.invoicePdf, 'base64').toString('latin1');
  assert.ok(pdf.includes('(Indian Farmers Fertilizer)'), 'billed to shows the order customer');
  assert.ok(pdf.includes('(C-1, DISTRICT CENTRE, SAKET)'));
  assert.ok(pdf.includes('(Tel: +911142592791)'));
  assert.equal(pdf.split('(GSTIN: 07AAACD1234E1Z5)').length - 1, 1, 'customer GSTIN is printed once, under billed to');

  const again = await api('POST', '/api/v1/orders/SHP-B2B-1/invoice', { token, json: { email: false } });
  const againPdf = Buffer.from(again.body.data.invoicePdf, 'base64').toString('latin1');
  assert.ok(againPdf.includes('(GSTIN: 07AAACD1234E1Z5)'), 'the saved customer GSTIN stays on later invoices');

  const cleared = await api('POST', '/api/v1/orders/SHP-B2B-1/invoice', { token, json: { email: false, customerGstin: '' } });
  assert.equal(cleared.body.data.customerGstin, '');
  const clearedPdf = Buffer.from(cleared.body.data.invoicePdf, 'base64').toString('latin1');
  assert.equal(clearedPdf.includes('07AAACD1234E1Z5'), false, 'a B2C invoice has no customer GSTIN');
});

test('with no warehouse state the seller state comes from the GSTIN: Delhi buyer CGST + SGST, other state IGST', async () => {
  const Tenant = require('../src/models/Tenant');
  const shop = await provisionMerchant({
    name: 'GST rule shop',
    ownerEmail: `gstrule-${Date.now()}@example.com`,
    ownerName: 'GST Owner',
    password: 'Password1',
    status: 'active',
  });
  const tenantId = shop.tenant._id;
  await Tenant.updateOne({ _id: tenantId }, { $set: { 'legalEntity.gstin': '07AAQCP4784P1ZB' } });
  await ensureDefaultWarehouses(tenantId);
  await Warehouse.updateOne(
    { tenantId, code: 'WH-001' },
    { $set: { 'address.state': '' } },
  ).setOptions({ skipTenantFilter: true });
  const base = { tenantId, channel: 'Shopify', status: 'Dispatched', source: 'channel_api', phone: '+919999999999' };
  await Order.create({
    ...base,
    orderNo: 'SHP-INTRA-1',
    externalOrderId: '8001',
    shipState: 'Delhi',
    customer: 'Praveen Dhiman',
    address: '315, D Block, Sector 18A Dwarka',
    city: 'New Delhi 110078',
    total: 1591,
    items: [{ name: 'Dress Material', sku: 'LEH-01-300', qty: 1, price: 1591, gst: 5, hsn: '52010011' }],
  });
  await Order.create({
    ...base,
    orderNo: 'SHP-INTER-1',
    externalOrderId: '8002',
    shipState: 'Maharashtra',
    customer: 'Madhuri Chandanshive',
    address: 'Nandini Apartment, Sreeram Nagar',
    city: 'Baramati 413102',
    total: 1359,
    items: [{ name: 'Dress Material', sku: 'Leh-ikat-150', qty: 1, price: 1359, gst: 5, hsn: '52010011' }],
  });
  const token = await login(shop.owner.email);

  const intra = await api('POST', '/api/v1/orders/SHP-INTRA-1/invoice', { token, json: { email: false } });
  assert.equal(intra.status, 200, JSON.stringify(intra.body));
  const intraPdf = Buffer.from(intra.body.data.invoicePdf, 'base64').toString('latin1');
  assert.ok(intraPdf.includes('(Total CGST:)') && intraPdf.includes('(Total SGST:)'), 'Delhi buyer gets CGST + SGST');
  assert.equal(intraPdf.split('(Rs. 37.88)').length - 1, 6);
  assert.ok(!intraPdf.includes('IGST'));

  const inter = await api('POST', '/api/v1/orders/SHP-INTER-1/invoice', { token, json: { email: false } });
  assert.equal(inter.status, 200, JSON.stringify(inter.body));
  const interPdf = Buffer.from(inter.body.data.invoicePdf, 'base64').toString('latin1');
  assert.ok(interPdf.includes('(Total IGST:)') && interPdf.includes('(Rs. 64.71)'), 'Maharashtra buyer gets full IGST');
  assert.ok(!interPdf.includes('CGST'));
});
