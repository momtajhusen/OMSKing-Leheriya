process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const Order = require('../src/models/Order');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const Product = require('../src/models/Product');
const SkuMapping = require('../src/models/SkuMapping');
const AuditLog = require('../src/models/AuditLog');
const shopify = require('../src/adapters/shopify');
const { pushMasterSkuHsnToShopify } = require('../src/services/shopifyHsn.service');

const PASSWORD = 'Password1';

let memory;
let server;
let base;
const originalPush = shopify.pushVariantHsn;

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
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function merchant(label) {
  const ownerEmail = `hsn-${label}-${Date.now()}@example.com`;
  const created = await provisionMerchant({ name: `Hsn ${label}`, ownerEmail, ownerName: 'Owner', password: PASSWORD, status: 'active' });
  const res = await api('POST', '/api/v1/auth/login', { json: { email: ownerEmail, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { tenantId: created.tenant._id, token: res.body.data.accessToken };
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  shopify.pushVariantHsn = originalPush;
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('tax settings save and return defaultHsn', async () => {
  const { token } = await merchant('tax');
  const saved = await api('PATCH', '/api/v1/settings/tax', {
    token,
    json: {
      defaultGstRate: 5,
      defaultHsn: '6109',
      categories: [{ name: 'Clothing', gstRate: 5 }],
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.defaultHsn, '6109');
  const got = await api('GET', '/api/v1/settings/tax', { token });
  assert.equal(got.body.data.defaultHsn, '6109');
});

test('channel ingest fills blank HSN from tax settings defaultHsn', async () => {
  const { tenantId, token } = await merchant('fill');
  await Tenant.updateOne({ _id: tenantId }, {
    $set: {
      'settings.taxGst.defaultHsn': '6204',
      'settings.taxGst.defaultGstRate': 5,
      'settings.taxGst.configured': true,
      'legalEntity.gstin': '07AAQCP4784P1ZB',
    },
  });
  const Warehouse = require('../src/models/Warehouse');
  const { ensureDefaultWarehouses } = require('../src/services/warehouse.service');
  await ensureDefaultWarehouses(tenantId);
  await Warehouse.updateOne({ tenantId, code: 'WH-001' }, { $set: { 'address.state': 'Delhi' } });
  const product = await Product.create({ tenantId, name: 'Kurta', hsnCode: '', gstRatePercent: 5 });
  const sku = await MasterSku.create({ tenantId, productId: product._id, code: 'KURTA-BLANK', name: 'Kurta', hsnCode: '', gstRatePercent: 5 });
  await Order.create({
    tenantId,
    orderNo: 'SHP-HSN-FILL',
    channel: 'Custom',
    status: 'New',
    customer: 'Test',
    address: 'Delhi',
    city: 'Delhi',
    shipState: 'Delhi',
    total: 500,
    items: [{ name: 'Kurta', sku: sku.code, masterSkuId: sku._id, qty: 1, price: 500, hsn: '', gst: 5 }],
  });
  const inv = await api('POST', '/api/v1/orders/SHP-HSN-FILL/invoice', { token, json: {} });
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  const order = await Order.findOne({ tenantId, orderNo: 'SHP-HSN-FILL' }).lean();
  assert.equal(order.items[0].hsn, '6204');
});

test('PATCH item HSN updates order + Master SKU + product and pushes Shopify', async () => {
  const { tenantId, token } = await merchant('edit');
  const { upsertConnection } = require('../src/services/channelConnection.service');
  await upsertConnection(tenantId, null, 'shopify', {
    credentials: { shopUrl: 'demo.myshopify.com', adminToken: 'shpat_test', apiMode: 'live' },
  });
  const product = await Product.create({ tenantId, name: 'Saree', hsnCode: '', gstRatePercent: 5 });
  const sku = await MasterSku.create({ tenantId, productId: product._id, code: 'SAREE-HSN', name: 'Saree', hsnCode: '' });
  await SkuMapping.create({
    tenantId,
    masterSkuId: sku._id,
    channel: 'shopify',
    channelSkuCode: 'SAREE-HSN',
    channelSkuCodeNorm: 'saree-hsn',
    channelVariantId: 'var-hsn-1',
    isActive: true,
  });
  await Order.create({
    tenantId,
    orderNo: 'SHP-HSN-EDIT',
    channel: 'Shopify',
    status: 'New',
    customer: 'Test',
    address: 'Delhi',
    city: 'Delhi',
    total: 999,
    items: [{ name: 'Saree', sku: sku.code, masterSkuId: sku._id, qty: 1, price: 999, hsn: '' }],
  });

  const pushed = [];
  shopify.pushVariantHsn = async (_creds, opts) => {
    pushed.push(opts);
    return { hsn: opts.hsn, inventoryItemId: '1' };
  };

  const res = await api('PATCH', '/api/v1/orders/SHP-HSN-EDIT/items/0/hsn', { token, json: { hsn: '61091000' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.items[0].hsn, '61091000');
  assert.match(res.body.message || '', /Shopify/i);

  const refreshed = await MasterSku.findById(sku._id).lean();
  assert.equal(refreshed.hsnCode, '61091000');
  const prod = await Product.findById(product._id).lean();
  assert.equal(prod.hsnCode, '61091000');
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].variantId, 'var-hsn-1');
  assert.equal(pushed[0].hsn, '61091000');

  const audit = await AuditLog.findOne({ tenantId, action: 'order.item_hsn_updated' }).lean();
  assert.ok(audit);
  assert.equal(audit.after.hsn, '61091000');

  shopify.pushVariantHsn = originalPush;
});

test('pushMasterSkuHsnToShopify soft-fails when Shopify is not connected', async () => {
  const { tenantId } = await merchant('soft');
  const sku = await MasterSku.create({ tenantId, code: 'SOFT-HSN', name: 'Soft' });
  await SkuMapping.create({
    tenantId,
    masterSkuId: sku._id,
    channel: 'shopify',
    channelSkuCode: 'SOFT-HSN',
    channelSkuCodeNorm: 'soft-hsn',
    channelVariantId: 'var-soft',
    isActive: true,
  });
  const out = await pushMasterSkuHsnToShopify(tenantId, sku._id, '6109');
  assert.equal(out.pushed, 0);
  assert.ok(out.failed.length >= 1);
});

test('invoice-locked order cannot change HSN', async () => {
  const { tenantId, token } = await merchant('lock');
  const sku = await MasterSku.create({ tenantId, code: 'LOCK-HSN', name: 'Lock' });
  await Order.create({
    tenantId,
    orderNo: 'SHP-HSN-LOCK',
    channel: 'Shopify',
    status: 'New',
    customer: 'Test',
    address: 'Delhi',
    city: 'Delhi',
    total: 100,
    invoiceGeneratedAt: new Date(),
    items: [{ name: 'Lock', sku: sku.code, masterSkuId: sku._id, qty: 1, price: 100, hsn: '6109' }],
  });
  const res = await api('PATCH', '/api/v1/orders/SHP-HSN-LOCK/items/0/hsn', { token, json: { hsn: '6204' } });
  assert.equal(res.status, 400);
});

test('pushVariantHsn writes harmonized_system_code', async () => {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, body: opts.body });
    if (url.includes('/variants/111.json')) {
      return { status: 200, text: JSON.stringify({ variant: { id: 111, inventory_item_id: 999 } }) };
    }
    if (url.includes('/inventory_items/999.json') && method === 'PUT') {
      return { status: 200, text: '{}' };
    }
    return { status: 404, text: '{}' };
  };
  const out = await shopify.pushVariantHsn(
    { shopUrl: 'demo.myshopify.com', adminToken: 'shpat_test' },
    { variantId: '111', hsn: '6109', request },
  );
  assert.equal(out.hsn, '6109');
  const put = calls.find((row) => row.method === 'PUT');
  assert.ok(put.url.endsWith('/inventory_items/999.json'));
  assert.deepEqual(put.body, { inventory_item: { id: 999, harmonized_system_code: '6109' } });
});
