process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { warehousesForChannel, ensureDefaultWarehouses } = require('../src/services/warehouse.service');
const Warehouse = require('../src/models/Warehouse');
const WarehouseLocationMap = require('../src/models/WarehouseLocationMap');
const Inventory = require('../src/models/Inventory');
const MasterSku = require('../src/models/MasterSku');
const AuditLog = require('../src/models/AuditLog');
const Order = require('../src/models/Order');
const { warehouseResolver } = require('../src/services/channelWarehouse.service');

const PASSWORD = 'Password1';
let memory;
let server;
let base;

async function api(method, path, { token, json } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function company(label) {
  const email = `owner-${label}-${Date.now()}@example.com`;
  const created = await provisionMerchant({
    name: `Links ${label}`, ownerEmail: email, ownerName: 'Owner', password: PASSWORD, status: 'active',
  });
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { tenantId: created.tenant._id, token: res.body.data.accessToken };
}

async function newWarehouse(token, code, type = 'physical') {
  const res = await api('POST', '/api/v1/warehouses', { token, json: { code, name: `${code} godown`, type, channels: [] } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await memory.stop();
});

test('links: add, edit, make main, and remove a channel ↔ warehouse link; defaults stop being forced', async () => {
  const { tenantId, token } = await company('crud');
  const listed = await api('GET', '/api/v1/warehouses/links', { token });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.data.connections.some((row) => row.channel === 'myntra' && row.warehouseCode === 'WH-001'));
  assert.ok(listed.body.data.channels.some((row) => row.id === 'flipkart'));

  const wh3 = await newWarehouse(token, 'WH-003');
  const added = await api('POST', '/api/v1/warehouses/links', {
    token, json: { channel: 'myntra', warehouseId: wh3.id, externalLocationId: 'C55185W28092', isPrimaryForChannel: true },
  });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.data.isPrimaryForChannel, true);
  const myntraRows = await WarehouseLocationMap.find({ tenantId, channel: 'myntra' }).setOptions({ skipTenantFilter: true });
  assert.equal(myntraRows.filter((row) => row.isPrimaryForChannel).length, 1, 'only one main warehouse per channel');
  assert.equal((await Warehouse.findById(wh3.id).setOptions({ skipTenantFilter: true })).sellOnMyntra, true);

  const dup = await api('POST', '/api/v1/warehouses/links', { token, json: { channel: 'myntra', warehouseId: wh3.id } });
  assert.equal(dup.status, 409);

  const wh1Myntra = myntraRows.find((row) => String(row.warehouseId) !== wh3.id);
  const removed = await api('DELETE', `/api/v1/warehouses/links/${wh1Myntra._id}`, { token });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const wh1 = await Warehouse.findOne({ tenantId, code: 'WH-001' }).setOptions({ skipTenantFilter: true });
  assert.equal(wh1.sellOnMyntra, false, 'removing the link stops WH-001 stock showing on Myntra');

  await ensureDefaultWarehouses(tenantId);
  assert.equal(await WarehouseLocationMap.exists({ tenantId, channel: 'myntra', warehouseId: wh1._id }).setOptions({ skipTenantFilter: true }), null, 'the removed default link is not re-created');
  assert.deepEqual((await warehousesForChannel(tenantId, 'myntra')).map((row) => row.code), ['WH-003']);

  const edited = await api('PATCH', `/api/v1/warehouses/links/${added.body.data.id}`, { token, json: { externalLocationId: 'C55185W99999', label: 'Myntra Delhi' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.data.externalLocationId, 'C55185W99999');

  const actions = (await AuditLog.find({ tenantId }).setOptions({ skipTenantFilter: true })).map((row) => row.action);
  assert.ok(actions.includes('warehouse.link_added') && actions.includes('warehouse.link_removed') && actions.includes('warehouse.link_updated'));
});

test('links: a virtual warehouse links to Shopify only, and another company cannot see or touch the links', async () => {
  const a = await company('va');
  const b = await company('vb');
  const virtual = await newWarehouse(a.token, 'WH-009', 'virtual');
  const bad = await api('POST', '/api/v1/warehouses/links', { token: a.token, json: { channel: 'amazon', warehouseId: virtual.id } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /virtual/);

  const link = (await api('GET', '/api/v1/warehouses/links', { token: a.token })).body.data.connections[0];
  assert.equal((await api('DELETE', `/api/v1/warehouses/links/${link.id}`, { token: b.token })).status, 404);
  assert.equal((await api('PATCH', `/api/v1/warehouses/links/${link.id}`, { token: b.token, json: { label: 'x' } })).status, 404);
  assert.equal((await api('POST', '/api/v1/warehouses/links', { token: b.token, json: { channel: 'shopify', warehouseId: virtual.id } })).status, 404);
  assert.equal((await api('DELETE', `/api/v1/warehouses/${virtual.id}`, { token: b.token })).status, 404);
  assert.equal((await api('GET', '/api/v1/warehouses/links')).status, 401);
});

test('delete warehouse: a mistaken empty warehouse is deleted; links need confirmation and go with it', async () => {
  const { tenantId, token } = await company('del');
  const spare = await newWarehouse(token, 'WH-004');
  assert.equal((await api('DELETE', `/api/v1/warehouses/${spare.id}`, { token })).status, 200);
  assert.equal(await Warehouse.exists({ _id: spare.id }).setOptions({ skipTenantFilter: true }), null);

  const linked = await newWarehouse(token, 'WH-005');
  await api('POST', '/api/v1/warehouses/links', { token, json: { channel: 'amazon', warehouseId: linked.id, isPrimaryForChannel: true } });
  const check = await api('GET', `/api/v1/warehouses/${linked.id}/delete-check`, { token });
  assert.equal(check.body.data.canDelete, true);
  assert.equal(check.body.data.links.length, 1);

  const refused = await api('DELETE', `/api/v1/warehouses/${linked.id}`, { token });
  assert.equal(refused.status, 409);
  assert.match(refused.body.message, /linked to 1 channel/);

  const done = await api('DELETE', `/api/v1/warehouses/${linked.id}?removeLinks=1`, { token });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await WarehouseLocationMap.exists({ warehouseId: linked.id }).setOptions({ skipTenantFilter: true }), null);
  const main = await WarehouseLocationMap.findOne({ tenantId, channel: 'amazon', isPrimaryForChannel: true }).setOptions({ skipTenantFilter: true });
  assert.ok(main, 'another Amazon warehouse becomes the main one');
  assert.ok((await AuditLog.exists({ tenantId, action: 'warehouse.deleted' }).setOptions({ skipTenantFilter: true })));
});

test('history, backup export and the order "ships from" warehouse', async () => {
  const a = await company('hist');
  const b = await company('hist-other');
  const wh = await newWarehouse(a.token, 'WH-020');
  const link = await api('POST', '/api/v1/warehouses/links', { token: a.token, json: { channel: 'myntra', warehouseId: wh.id, externalLocationId: 'C55185W28092' } });
  await api('PATCH', `/api/v1/warehouses/links/${link.body.data.id}`, { token: a.token, json: { isPrimaryForChannel: true } });

  const history = await api('GET', '/api/v1/warehouses/links/history', { token: a.token });
  assert.equal(history.status, 200);
  const rows = history.body.data;
  assert.deepEqual(rows.slice(0, 3).map((row) => row.action), ['Link changed', 'Link added', 'Warehouse added']);
  assert.equal(rows[0].channel, 'Myntra');
  assert.equal(rows[0].warehouse, 'WH-020');
  assert.match(rows[0].detail, /made main/);
  assert.equal(rows[0].user, 'Owner');
  assert.ok(rows[0].at);
  assert.equal((await api('GET', '/api/v1/warehouses/links/history', { token: b.token })).body.data.length, 0, 'another company sees none of it');

  const json = await fetch(`${base}/api/v1/warehouses/links/export`, { headers: { authorization: `Bearer ${a.token}` } });
  assert.equal(json.status, 200);
  assert.match(json.headers.get('content-disposition'), /attachment; filename="channel-warehouse-\d{4}-\d{2}-\d{2}\.json"/);
  const setup = await json.json();
  assert.equal(setup.format, 'omsking.channel-warehouse.v1');
  assert.ok(setup.warehouses.some((row) => row.code === 'WH-020'));
  assert.ok(setup.links.some((row) => row.channel === 'myntra' && row.warehouseCode === 'WH-020' && row.externalLocationId === 'C55185W28092' && row.isPrimaryForChannel));
  const otherSetup = await (await fetch(`${base}/api/v1/warehouses/links/export`, { headers: { authorization: `Bearer ${b.token}` } })).json();
  assert.ok(!otherSetup.warehouses.some((row) => row.code === 'WH-020'));

  const csv = await fetch(`${base}/api/v1/warehouses/links/export?format=csv`, { headers: { authorization: `Bearer ${a.token}` } });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const text = await csv.text();
  assert.match(text.split('\n')[0], /^Channel,Warehouse code,Warehouse name/);
  assert.match(text, /Myntra,WH-020,WH-020 godown,physical,active,C55185W28092,.*,Yes/);

  const resolve = await warehouseResolver(a.tenantId);
  assert.equal(resolve({ channel: 'Myntra', warehouseCode: 'C55185W28092' }).code, 'WH-020', 'Myntra warehouse id maps to the linked warehouse');
  assert.equal(resolve({ channel: 'Myntra', warehouseCode: '' }).source, 'main warehouse');
  assert.equal(resolve({ channel: 'Shopify', warehouseCode: 'WH-002' }).code, 'WH-002');
  assert.equal(resolve({ channel: 'Unknown', warehouseCode: '' }), null);
});

test('delete warehouse: stock on hand and open orders block it; finished orders only warn', async () => {
  const { tenantId, token } = await company('block');
  const stocked = await newWarehouse(token, 'WH-006');
  const sku = await MasterSku.create({ tenantId, code: `SKU-${Date.now()}`, name: 'Kurta' });
  await Inventory.create({ tenantId, masterSkuId: sku._id, warehouseId: stocked.id, physicalQty: 3 });
  const check = await api('GET', `/api/v1/warehouses/${stocked.id}/delete-check`, { token });
  assert.equal(check.body.data.canDelete, false);
  assert.match(check.body.data.blockers.join(' '), /stock/);
  assert.equal((await api('DELETE', `/api/v1/warehouses/${stocked.id}?removeLinks=1`, { token })).status, 409);
  assert.ok(await Warehouse.exists({ _id: stocked.id }).setOptions({ skipTenantFilter: true }));

  const busy = await newWarehouse(token, 'WH-007');
  const order = await Order.create({ tenantId, orderNo: `ORD-${Date.now()}`, channel: 'Myntra', status: 'Packed', warehouseCode: 'WH-007' });
  const open = await api('DELETE', `/api/v1/warehouses/${busy.id}?removeLinks=1`, { token });
  assert.equal(open.status, 409);
  assert.match(open.body.message, /open order/);

  await Order.updateOne({ _id: order._id }, { $set: { status: 'Delivered' } }).setOptions({ skipTenantFilter: true });
  const warned = await api('GET', `/api/v1/warehouses/${busy.id}/delete-check`, { token });
  assert.equal(warned.body.data.canDelete, true);
  assert.match(warned.body.data.warnings.join(' '), /Finished orders/);
  assert.equal((await api('DELETE', `/api/v1/warehouses/${busy.id}?removeLinks=1`, { token })).status, 200);
});

test('fully user-managed: WH-002 can be deleted and does not come back; a new warehouse picks its own channels', async () => {
  const { tenantId, token } = await company('free');
  const wh2 = await Warehouse.findOne({ tenantId, code: 'WH-002' }).setOptions({ skipTenantFilter: true });
  const check = await api('GET', `/api/v1/warehouses/${wh2._id}/delete-check`, { token });
  assert.equal(check.body.data.canDelete, true);
  assert.equal((await api('DELETE', `/api/v1/warehouses/${wh2._id}?removeLinks=1`, { token })).status, 200);
  const listed = await api('GET', '/api/v1/warehouses', { token });
  assert.deepEqual(listed.body.data.warehouses.map((row) => row.code), ['WH-001'], 'WH-002 is not re-created');

  const created = await api('POST', '/api/v1/warehouses', { token, json: { code: 'WH-010', name: 'Jaipur', type: 'physical', channels: ['flipkart', 'ajio'] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.data.channels, ['flipkart', 'ajio']);
  assert.ok((await warehousesForChannel(tenantId, 'flipkart')).some((row) => row.code === 'WH-010'));
  assert.ok(!(await warehousesForChannel(tenantId, 'amazon')).some((row) => row.code === 'WH-010'), 'only the picked channels see it');
  assert.ok((await warehousesForChannel(tenantId, 'amazon')).some((row) => row.code === 'WH-001'), 'existing links survive the switch');
});
