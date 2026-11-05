process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { hashPassword } = require('../src/lib/password');
const { applyDeskRules } = require('../src/services/orderDesk.service');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const Order = require('../src/models/Order');
const MasterSku = require('../src/models/MasterSku');
const Warehouse = require('../src/models/Warehouse');
const Inventory = require('../src/models/Inventory');
const NotificationDelivery = require('../src/models/NotificationDelivery');
const app = require('../src/app');

function order(id, subs, overrides = {}) {
  return {
    id,
    orderNo: id,
    status: 'New',
    channel: 'Shopify',
    paymentMode: 'Prepaid',
    createdAt: '2026-01-01',
    items: [{ sku: 'S', qty: subs.length, masterSkuId: 'sku1' }],
    subOrders: subs.map((sub, index) => ({ id: `${id}-${index + 1}`, sku: 'S', qty: 1, ...sub })),
    ...overrides,
  };
}

const vendor = (vendorStatus, extra = {}) => ({ assignedVendor: 'Vendor A', vendorStatus, ...extra });
const noStock = { physical: new Map(), virtual: new Map() };

test('an order is ready when every vendor line is Delivered', () => {
  const [ready, notYet] = applyDeskRules([
    order('R1', [vendor('Delivered'), vendor('Delivered')]),
    order('R2', [vendor('Delivered'), vendor('Dispatched')]),
  ], noStock);
  assert.equal(ready.orderReady, true);
  assert.equal(notYet.orderReady, false);
});

test('an order is ready when the offline store has stock for its vendor lines', () => {
  const [row] = applyDeskRules([order('R3', [vendor('Accepted')])], { physical: new Map([['sku1', 2]]), virtual: new Map() });
  assert.equal(row.orderReady, true);
  assert.equal(row.subOrders[0].offlineQty, 2);
  const [none] = applyDeskRules([order('R3', [vendor('Accepted')])], noStock);
  assert.equal(none.orderReady, false);
  assert.equal(none.subOrders[0].offlineQty, 0);
});

test('offline stock makes the oldest waiting order ready first', () => {
  const rows = applyDeskRules([
    order('NEW', [vendor('Accepted')], { createdAt: '2026-01-02' }),
    order('OLD', [vendor('Accepted')], { createdAt: '2026-01-01' }),
  ], { physical: new Map([['sku1', 1]]), virtual: new Map() });
  assert.equal(rows.find((row) => row.id === 'OLD').orderReady, true);
  assert.equal(rows.find((row) => row.id === 'NEW').orderReady, false);
});

test('offline-only, closed and unassigned out-of-stock orders are not tagged; cancelled lines are ignored', () => {
  const rows = applyDeskRules([
    order('OFF', [{}]),
    order('SHIP', [vendor('Delivered')], { status: 'Shipped' }),
    order('OOS', [{}], { channel: 'Myntra' }),
    order('CAN', [vendor('Delivered'), vendor('Accepted', { status: 'Cancelled' })]),
  ], { physical: new Map([['sku1', 1]]), virtual: new Map() });
  const by = Object.fromEntries(rows.map((row) => [row.id, row.orderReady]));
  assert.deepEqual(by, { OFF: false, SHIP: false, OOS: false, CAN: true });
  const [oos] = applyDeskRules([order('OOS', [{}], { channel: 'Myntra' })], noStock);
  assert.equal(oos.orderReady, false);
});

let memory;
let server;
let base;
let token;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const tenant = await Tenant.create({ name: 'Ready Desk', slug: `ready-desk-${Date.now()}`, kind: 'merchant', status: 'active' });
  const other = await Tenant.create({ name: 'Other Desk', slug: `other-desk-${Date.now()}`, kind: 'merchant', status: 'active' });
  const role = await Role.create({ tenantId: tenant._id, code: 'ops', name: 'Ops', permissions: ['orders.view'], isSystem: false });
  await User.create({
    tenantId: tenant._id,
    fullName: 'Ops',
    email: 'ready-ops@example.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });
  const stocked = await MasterSku.create({ tenantId: tenant._id, code: 'STOCKED', name: 'Stocked' });
  const empty = await MasterSku.create({ tenantId: tenant._id, code: 'EMPTY', name: 'Empty' });
  const store = await Warehouse.create({ tenantId: tenant._id, code: 'WH-001', name: 'Store', type: 'physical' });
  await Inventory.create({ tenantId: tenant._id, masterSkuId: stocked._id, warehouseId: store._id, physicalQty: 3 });

  const line = (orderNo, sku, masterSkuId, vendorStatus, extra = {}) => ({
    tenantId: tenant._id,
    orderNo,
    source: 'channel_api',
    channel: 'Shopify',
    status: 'New',
    items: [{ name: sku, sku, qty: 1, price: 100, masterSkuId }],
    subOrders: [{ id: `${orderNo}-1`, index: 1, sku, qty: 1, price: 100, assignedVendor: 'Vendor A', fulfilmentSource: 'Virtual', vendorStatus, ...extra }],
  });
  await Order.create([
    line('RDY-1', 'EMPTY', empty._id, 'Delivered'),
    line('RDY-2', 'EMPTY', empty._id, 'Dispatched', { trackingNumber: 'AWB1', courier: 'DTDC' }),
    line('RDY-3', 'STOCKED', stocked._id, 'Accepted'),
    { ...line('RDY-X', 'EMPTY', empty._id, 'Delivered'), tenantId: other._id },
  ]);
  await NotificationDelivery.create([
    { tenantId: tenant._id, eventKey: 'NOT-002', dedupeKey: 'vendor.assigned:RDY-2:RDY-2-1:vendor a', channel: 'telegram', status: 'failed' },
    { tenantId: tenant._id, eventKey: 'NOT-002', dedupeKey: 'vendor.assigned:RDY-3:RDY-3-1:vendor a', channel: 'telegram', status: 'sent' },
  ]);

  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ready-ops@example.com', password: 'Password1' }),
  });
  assert.equal(login.status, 200);
  token = (await login.json()).data.accessToken;
});

test.after(async () => {
  server.close();
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

async function get(path) {
  const res = await fetch(`${base}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  return res.json();
}

const idsOf = (body) => body.data.map((row) => row.id).sort();

test('orders list filters ready orders and vendor parcel status within the tenant', async () => {
  const ready = await get('/orders?ready=ready');
  assert.deepEqual(idsOf(ready), ['RDY-1', 'RDY-3']);
  assert.ok(ready.data.every((row) => row.orderReady === true));
  assert.equal(ready.meta.counts.Ready, 2);

  assert.deepEqual(idsOf(await get('/orders?ready=not_ready')), ['RDY-2']);
  assert.deepEqual(idsOf(await get('/orders?ready=all')), ['RDY-1', 'RDY-2', 'RDY-3']);
  assert.deepEqual(idsOf(await get('/orders?parcel=Dispatched')), ['RDY-2']);
  assert.deepEqual(idsOf(await get('/orders?parcel=Delivered')), ['RDY-1']);
});

test('order detail shows offline stock and whether the vendor assignment message went out', async () => {
  const sent = (await get('/orders/RDY-3')).data;
  assert.equal(sent.subOrders[0].offlineQty, 3);
  assert.equal(sent.subOrders[0].assignNotice, 'sent');
  assert.equal((await get('/orders/RDY-2')).data.subOrders[0].assignNotice, 'failed');
  assert.equal((await get('/orders/RDY-1')).data.subOrders[0].assignNotice, '');
});
