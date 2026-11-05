process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const masterSkus = require('../src/controllers/masterSkus.controller');
const settings = require('../src/controllers/settings.controller');
const { effectivePackage } = require('../src/services/packageDefaults.service');
const Order = require('../src/models/Order');
const Warehouse = require('../src/models/Warehouse');
const { bookShopify } = require('../src/services/ship.service');

let memory;

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(tenant, handler, req = {}) {
  const res = fakeRes();
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false }, () => handler({
    tenantId: String(tenant._id),
    user: { id: null, role: 'super_admin' },
    params: {},
    query: {},
    body: {},
    ...req,
  }, res));
  return res.body;
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await MasterSku.syncIndexes();
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('each Master SKU saves its own courier weight and dimensions', async () => {
  const tenant = await Tenant.create({ name: 'Pkg shop', slug: `pkg-${Date.now()}`, kind: 'merchant' });
  const created = await call(tenant, masterSkus.createMasterSku, {
    body: { name: 'Dupatta', weightKg: 0.4, dimensionsCm: { l: 30, w: 20, h: 3 } },
  });
  assert.equal(created.data.weightKg, 0.4);
  assert.deepEqual(created.data.dimensionsCm, { l: 30, w: 20, h: 3 });

  const updated = await call(tenant, masterSkus.updateMasterSku, {
    params: { id: created.data.id },
    body: { weightKg: 0.5, dimensionsCm: { l: 32, w: 22, h: 4 } },
  });
  assert.equal(updated.data.weightKg, 0.5);
  assert.deepEqual(updated.data.dimensionsCm, { l: 32, w: 22, h: 4 });

  await assert.rejects(
    call(tenant, masterSkus.updateMasterSku, { params: { id: created.data.id }, body: { weightKg: -1 } }),
    /Weight/,
  );
});

test('tenant default package is editable and can be applied to every product of that tenant only', async () => {
  const tenant = await Tenant.create({ name: 'Default shop', slug: `def-${Date.now()}`, kind: 'merchant' });
  const other = await Tenant.create({ name: 'Other shop', slug: `oth-${Date.now()}`, kind: 'merchant' });
  await MasterSku.create({ tenantId: tenant._id, code: 'DEF-1', name: 'One', weightKg: 1 });
  await MasterSku.create({ tenantId: tenant._id, code: 'DEF-2', name: 'Two' });
  await MasterSku.create({ tenantId: other._id, code: 'OTH-1', name: 'Other', weightKg: 2 });

  const blank = await call(tenant, settings.getPackageDefaults);
  assert.deepEqual(blank.data, { weightKg: 0, lengthCm: 0, breadthCm: 0, heightCm: 0 });

  const saved = await call(tenant, settings.patchPackageDefaults, {
    body: { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 5 },
  });
  assert.deepEqual(saved.data.defaults, { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 5 });
  assert.equal(saved.data.appliedCount, 0);
  assert.equal((await MasterSku.findOne({ code: 'DEF-1' })).weightKg, 1, 'saving alone does not overwrite products');

  const applied = await call(tenant, settings.patchPackageDefaults, {
    body: { weightKg: 0.6, lengthCm: 31, breadthCm: 26, heightCm: 6, applyToAll: true },
  });
  assert.equal(applied.data.appliedCount, 2);
  const mine = await MasterSku.find({ tenantId: tenant._id });
  mine.forEach((row) => {
    assert.equal(row.weightKg, 0.6);
    assert.deepEqual({ ...row.dimensionsCm.toObject() }, { l: 31, w: 26, h: 6 });
  });
  const theirs = await MasterSku.findOne({ code: 'OTH-1' });
  assert.equal(theirs.weightKg, 2, 'another tenant is never touched');

  await assert.rejects(
    call(tenant, settings.patchPackageDefaults, { body: { weightKg: -2 } }),
    /Weight/,
  );
});

test('a product without its own weight or size falls back to the tenant default', () => {
  const defaults = { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 5 };
  assert.deepEqual(
    effectivePackage({ weightKg: 0, dimensionsCm: { l: 0, w: 0, h: 0 } }, defaults),
    { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 5, source: 'default' },
  );
  assert.deepEqual(
    effectivePackage({ weightKg: 1.2, dimensionsCm: { l: 40, w: 30, h: 10 } }, defaults),
    { weightKg: 1.2, lengthCm: 40, breadthCm: 30, heightCm: 10, source: 'product' },
  );
});

test('Delhivery booking sends weight and L/B/H from each product, falling back to the tenant default', async () => {
  const tenant = await Tenant.create({
    name: 'Courier shop',
    slug: `cour-${Date.now()}`,
    kind: 'merchant',
    settings: { packageDefaults: { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 5 } },
  });
  await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Pickup',
    type: 'physical',
    isPickup: true,
    address: { line1: 'Workshop lane', city: 'Jaipur', pincode: '302001' },
    contactPhone: '9000000000',
  });
  const own = await MasterSku.create({ tenantId: tenant._id, code: 'PKG-OWN', name: 'Saree', weightKg: 1.2, dimensionsCm: { l: 40, w: 30, h: 10 } });
  await MasterSku.create({ tenantId: tenant._id, code: 'PKG-DEF', name: 'Dupatta' });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'PKG-1',
    channel: 'Shopify',
    paymentMode: 'Prepaid',
    city: 'Jaipur 302001',
    externalOrderId: 'gid-PKG-1',
    items: [
      { name: 'Saree', sku: 'PKG-OWN', masterSkuId: own._id, qty: 1 },
      { name: 'Dupatta', sku: 'PKG-DEF', qty: 2 },
    ],
    source: 'manual',
  });

  const calls = [];
  const delhiveryRequest = async (method, url, opts = {}) => {
    calls.push({ url, body: opts.body });
    if (url.includes('pin-codes')) return { status: 200, text: JSON.stringify({ delivery_codes: [{ postal_code: { pre_paid: 'Y', cash: 'Y' } }] }) };
    if (url.includes('/api/cmu/create.json')) return { status: 200, text: JSON.stringify({ packages: [{ waybill: 'AWB-PKG', status: 'Success' }] }) };
    if (url.includes('packing_slip')) return { status: 200, text: '%PDF-1.4 label' };
    throw new Error(`unexpected Delhivery call ${url}`);
  };
  const shopifyRequest = async (method, url) => {
    if (url.includes('fulfillment_orders')) return { status: 200, text: JSON.stringify({ fulfillment_orders: [{ id: 77 }] }) };
    if (url.endsWith('/fulfillments.json')) return { status: 200, text: JSON.stringify({ fulfillment: { id: 88 } }) };
    throw new Error(`unexpected Shopify call ${url}`);
  };

  await bookShopify(tenant._id, 'PKG-1', {
    delhiveryCreds: { apiToken: 'dlv-test', pickupWarehouse: 'WH-001', clientName: 'Leheriya' },
    delhiveryRequest,
    shopifyCreds: { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' },
    shopifyRequest,
  });

  const created = calls.find((call) => call.url.includes('create.json'));
  const data = JSON.parse(decodeURIComponent(String(created.body).replace(/^format=json&data=/, '')));
  const row = data.shipments[0];
  assert.equal(row.weight, 2200, 'grams: 1.2 kg own + 2 × 0.5 kg default');
  assert.equal(row.shipment_length, 40);
  assert.equal(row.shipment_width, 30);
  assert.equal(row.shipment_height, 20, 'items stacked: 10 + 2 × 5');
});
