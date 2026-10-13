process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Role = require('../src/models/Role');
const User = require('../src/models/User');
const WarehouseLocationMap = require('../src/models/WarehouseLocationMap');
const ChannelConnection = require('../src/models/ChannelConnection');
const MasterSku = require('../src/models/MasterSku');
const SkuMapping = require('../src/models/SkuMapping');
const Inventory = require('../src/models/Inventory');
const InventoryLedger = require('../src/models/InventoryLedger');
const Order = require('../src/models/Order');
const Shipment = require('../src/models/Shipment');
const PlatformPricing = require('../src/models/PlatformPricing');
const { encryptObject } = require('../src/lib/secretBox');
const { ensureDefaultWarehouses } = require('../src/services/warehouse.service');
const { createCourier } = require('../src/services/courierAccount.service');

const COURIER_TOKEN = 'courier-secret-token-xyz';
const SHOPIFY_SECRET = 'shopify-secret-value';
const ROLE_CODES = ['super_admin', 'operations', 'warehouse', 'accounts', 'catalog_manager', 'customer_support', 'vendor'];

let memory;
let checklist;

function step(data, id) {
  return data.steps.find((row) => row.id === id);
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  checklist = require('../src/services/setupChecklist.service');
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

async function merchant(name) {
  return Tenant.create({
    name,
    slug: `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: 'merchant',
    legalEntity: { email: 'owner@example.com' },
  });
}

test('a new merchant has only the default inventory source ticked', async () => {
  const row = await merchant('empty-shop');
  const data = await checklist.tenantChecklist(row._id);
  assert.equal(data.audience, 'tenant');
  assert.deepEqual(data.steps.map((item) => item.id), [
    'access', 'company', 'authority', 'tax', 'warehouses', 'pickup',
    'shopify', 'locations', 'myntra', 'amazon', 'courier', 'catalog', 'stock', 'pipeline',
  ]);
  assert.equal(step(data, 'authority').done, true);
  for (const id of ['access', 'company', 'tax', 'warehouses', 'pickup', 'shopify', 'locations', 'myntra', 'amazon', 'courier', 'catalog', 'stock', 'pipeline']) {
    assert.equal(step(data, id).done, false, id);
  }
  assert.equal(data.completed, 1);
  assert.equal(data.nextId, 'access');
  const pickup = step(data, 'pickup');
  assert.ok(pickup.clicks.some((line) => /Pickup address/.test(line)));
  assert.ok(pickup.sources.some((line) => /Shopify Admin/.test(line)));
  assert.ok(pickup.sources.some((line) => /Delhivery/.test(line)));
  const company = step(data, 'company');
  assert.ok(company.clicks.some((line) => /Company Details/.test(line)));
  assert.ok(company.sources.some((line) => /GST registration/.test(line)));
});

test('completed setup ticks from saved data and never returns secrets', async () => {
  const row = await merchant('ready-shop');
  const other = await merchant('other-shop');
  await Role.insertMany(ROLE_CODES.map((code) => ({
    tenantId: row._id,
    code,
    name: code,
    permissions: [],
    isSystem: true,
  })));
  const superRole = await Role.findOne({ tenantId: row._id, code: 'super_admin' });
  await User.create({
    tenantId: row._id,
    fullName: 'Owner',
    email: 'owner@example.com',
    passwordHash: 'hashed',
    roleId: superRole._id,
    status: 'active',
  });
  row.name = 'Ready Shop';
  row.legalEntity = {
    email: 'owner@example.com',
    phone: '9876543210',
    gstin: '27AAAAA0000A1Z5',
    pan: 'AAAAA0000A',
    address: 'Godown lane',
    city: 'Jaipur',
    district: 'Jaipur',
  };
  row.settings.taxGst.configured = true;
  row.settings.inventoryAuthority = 'oms';
  await row.save();

  const warehouses = await ensureDefaultWarehouses(row._id);
  warehouses.physical.address = { line1: 'Godown lane', city: 'Jaipur', state: 'Rajasthan', pincode: '302001' };
  warehouses.physical.contactPhone = '9876543210';
  await warehouses.physical.save();

  let data = await checklist.tenantChecklist(row._id);
  assert.equal(step(data, 'locations').done, false);

  await WarehouseLocationMap.updateOne(
    { tenantId: row._id, channel: 'shopify', externalLocationId: 'shopify-location-a' },
    { $set: { externalLocationId: '10001' } },
  ).setOptions({ skipTenantFilter: true });
  await WarehouseLocationMap.updateOne(
    { tenantId: row._id, channel: 'shopify', externalLocationId: 'shopify-location-b' },
    { $set: { externalLocationId: '10002' } },
  ).setOptions({ skipTenantFilter: true });

  await ChannelConnection.create({
    tenantId: row._id,
    channel: 'shopify',
    status: 'connected',
    lastTestOk: true,
    credentialsEnc: encryptObject({ adminToken: SHOPIFY_SECRET }),
  });
  await ChannelConnection.create({
    tenantId: row._id,
    channel: 'myntra',
    status: 'connected',
    lastTestOk: true,
    warehouseCode: '74639',
    credentialsEnc: encryptObject({ secretKey: 'myntra-secret-value' }),
  });
  data = await checklist.tenantChecklist(row._id);
  assert.equal(step(data, 'myntra').done, false);

  await ChannelConnection.updateOne(
    { tenantId: row._id, channel: 'myntra' },
    { $set: { warehouseCode: 'C00000W00000' } },
  ).setOptions({ skipTenantFilter: true });
  await ChannelConnection.create({
    tenantId: row._id,
    channel: 'amazon',
    status: 'connected',
    lastTestOk: true,
    credentialsEnc: encryptObject({ refreshToken: 'amazon-secret-value' }),
  });
  await createCourier(row._id, null, {
    source: 'own',
    code: 'delhivery',
    status: 'active',
    credentials: { apiToken: COURIER_TOKEN, clientName: 'Ready Shop' },
  });
  data = await checklist.tenantChecklist(row._id);
  assert.equal(step(data, 'courier').done, false);

  const { updateCourier, listCouriers } = require('../src/services/courierAccount.service');
  const accounts = await listCouriers(row._id);
  const delhivery = accounts.accounts.find((item) => item.code === 'delhivery' && item.source === 'own');
  await updateCourier(row._id, null, delhivery.id, {
    credentials: { pickupWarehouse: 'Main godown' },
  });

  const sku = await MasterSku.create({ tenantId: row._id, code: 'KURTA-1', name: 'Kurta' });
  for (const channel of ['shopify', 'myntra', 'amazon']) {
    await SkuMapping.create({
      tenantId: row._id,
      masterSkuId: sku._id,
      channel,
      channelVariantId: `${channel}-1`,
      channelSkuCode: 'KURTA-1',
      channelSkuCodeNorm: 'kurta-1',
      syncStatus: 'synced',
    });
  }
  await Inventory.create({
    tenantId: row._id,
    masterSkuId: sku._id,
    warehouseId: warehouses.physical._id,
    physicalQty: 4,
  });
  await InventoryLedger.create({
    tenantId: row._id,
    masterSkuId: sku._id,
    warehouseId: warehouses.physical._id,
    transactionId: 'open-1',
    movementType: 'purchase_receipt',
    qtyDelta: 4,
    balanceAfter: 4,
  });
  await Order.create({
    tenantId: row._id,
    orderNo: 'ORD-1',
    externalOrderId: 'ext-1',
    channel: 'Shopify',
    status: 'New',
  });
  await InventoryLedger.create({
    tenantId: row._id,
    masterSkuId: sku._id,
    warehouseId: warehouses.physical._id,
    transactionId: 'reserve-1',
    movementType: 'order_reserve',
    qtyDelta: -1,
    balanceAfter: 4,
    reservedAfter: 1,
  });
  await Shipment.create({
    tenantId: row._id,
    orderNo: 'ORD-1',
    channel: 'shopify',
    courier: 'Delhivery',
    awb: 'AWB100',
    status: 'booked',
  });

  data = await checklist.tenantChecklist(row._id);
  assert.equal(data.completed, data.total);
  assert.equal(data.nextId, '');
  for (const item of data.steps) assert.equal(item.done, true, item.id);

  const packed = JSON.stringify(data);
  assert.equal(packed.includes(COURIER_TOKEN), false);
  assert.equal(packed.includes(SHOPIFY_SECRET), false);
  assert.equal(packed.includes('myntra-secret-value'), false);
  assert.equal(packed.includes('amazon-secret-value'), false);

  const isolated = await checklist.tenantChecklist(other._id);
  assert.equal(step(isolated, 'shopify').done, false);
  assert.equal(step(isolated, 'stock').done, false);
  assert.equal(step(isolated, 'pipeline').done, false);
});

test('platform redis check does not throw when the queue is down', async () => {
  const { redisReachable } = require('../src/services/bullTransport');
  assert.equal(typeof redisReachable, 'function');
  const data = await checklist.platformChecklist({
    mailConfigured: false,
    publicAppUrl: '',
    publicBaseUrl: '',
    encryptionKey: 'change-me-channel-encryption-key',
    jwtAccess: 'change-this-access-secret-in-production',
    jwtRefresh: 'change-this-refresh-secret-in-production',
    redisUrl: 'redis://127.0.0.1:1',
  });
  assert.equal(step(data, 'redis').done, false);
  assert.equal(data.steps.length, 8);
});

test('platform setup ticks environment facts without echoing secrets', async () => {
  await User.deleteMany({});
  await Role.deleteMany({ code: 'super_admin' });
  const blocked = await checklist.platformChecklist({
    mailConfigured: false,
    publicAppUrl: '',
    publicBaseUrl: '',
    encryptionKey: 'change-me-channel-encryption-key',
    jwtAccess: 'change-this-access-secret-in-production',
    jwtRefresh: 'change-this-refresh-secret-in-production',
    redisUrl: '',
    redisReachable: async () => { throw new Error('redis should not be called'); },
  });
  assert.equal(blocked.audience, 'platform');
  assert.ok(step(blocked, 'https').clicks.some((line) => /App link in emails/.test(line)));
  assert.ok(step(blocked, 'mail').sources.some((line) => /App passwords/.test(line)));
  assert.ok(step(blocked, 'encryption').clicks.some((line) => /CHANNEL_ENCRYPTION_KEY/.test(line)));
  assert.equal(step(blocked, 'database').done, true);
  for (const id of ['encryption', 'jwt', 'redis', 'https', 'mail', 'subscriber', 'plans']) {
    assert.equal(step(blocked, id).done, false, id);
  }

  const ownerTenant = await merchant('first-subscriber');
  await Role.create({ tenantId: ownerTenant._id, code: 'super_admin', name: 'Merchant Super Admin', permissions: [] });
  const role = await Role.findOne({ tenantId: ownerTenant._id, code: 'super_admin' });
  await User.create({
    tenantId: ownerTenant._id,
    fullName: 'Owner',
    email: 'first@example.com',
    passwordHash: 'hashed',
    roleId: role._id,
    status: 'active',
  });
  await PlatformPricing.create({
    key: 'default',
    minimumMonthlyPaise: 100000,
    slabs: [{ upTo: 1000, ratePaise: 200 }],
  });

  const ready = await checklist.platformChecklist({
    mailConfigured: true,
    publicAppUrl: 'https://app.example.com',
    publicBaseUrl: '',
    encryptionKey: 'a-real-channel-encryption-key',
    jwtAccess: 'a-real-access-secret-value',
    jwtRefresh: 'a-real-refresh-secret-value',
    redisUrl: 'redis://ok',
    redisReachable: async (url) => url === 'redis://ok',
  });
  assert.equal(ready.completed, ready.total);
  const packed = JSON.stringify(ready);
  assert.equal(packed.includes('a-real-channel-encryption-key'), false);
  assert.equal(packed.includes('a-real-access-secret-value'), false);
  assert.equal(packed.includes('a-real-refresh-secret-value'), false);
});
