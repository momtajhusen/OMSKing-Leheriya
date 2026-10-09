process.env.NODE_ENV = 'test';
process.env.CHANNEL_ENCRYPTION_KEY = 'myntra-test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const SkuMapping = require('../src/models/SkuMapping');
const WebhookEvent = require('../src/models/WebhookEvent');
const MasterSku = require('../src/models/MasterSku');
const { createMyntraClient, orderWindows, extractPdf } = require('../src/adapters/myntra/client');
const { upsertConnection } = require('../src/services/channelConnection.service');
const { pullMyntraOrders, mapMyntraOrder, orderStatus, parseMyntraDate } = require('../src/services/myntraSync.service');
const app = require('../src/app');

let memory;
let server;
let base;

function reply(status, json, headers = {}) {
  return { status, headers, buffer: Buffer.from(JSON.stringify(json)) };
}

function detail(sellerOrderId, lines) {
  return {
    statusCode: 1005,
    statusType: 'SUCCESS',
    receiverName: 'Test Buyer',
    address: 'Street 1',
    locality: 'Area',
    city: 'Jaipur',
    stateName: 'Rajasthan',
    zipcode: '302001',
    mobile: '9999999999',
    paymentMethod: 'cod',
    sellerOrderId,
    trackingNumber: lines.some((l) => l.status_code === 'SH') ? 'MYEC123' : null,
    orderLineEntries: lines.map((l, i) => ({
      orderLineId: `${sellerOrderId}-L${i}`,
      sku: l.sku,
      quantity: 1,
      mrp: 2000,
      lineFinalAmount: l.amount || 999,
      status_code: l.status_code,
      warehouse: 'C55185W28092',
      packetId: l.packetId || null,
      invoiceNumber: l.invoiceNumber || null,
      createdOn: '05-10-2026 10:15:00',
      taxEntries: [{ taxType: 'IGST', taxRate: 5 }],
    })),
  };
}

function fakeMyntra({ orders, details }) {
  const calls = [];
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url, headers: opts.headers, body: opts.body });
    const u = new URL(url);
    if (u.pathname === '/authorization/generate_token') {
      return reply(200, { statusType: 'SUCCESS' }, { access_token: 'acc-1', refresh_token: 'ref-1' });
    }
    if (u.pathname === '/authorization/refresh_token') {
      return reply(200, { statusType: 'SUCCESS' }, { access_token: 'acc-2', refresh_token: 'ref-2' });
    }
    if (u.pathname === '/partner/v4/order/getOrderList') {
      const page = Number(u.searchParams.get('page'));
      const rows = orders.slice(page * 2, page * 2 + 2);
      return reply(200, { data: rows, pages: Math.ceil(orders.length / 2), totalCount: orders.length });
    }
    const m = u.pathname.match(/^\/partner\/v4\/order\/([^/]+)$/);
    if (m) return reply(200, details[decodeURIComponent(m[1])]);
    if (u.pathname === '/partner/v4/inventory/update') return reply(200, { statusType: 'SUCCESS' });
    return reply(404, { statusMessage: 'not found' });
  };
  return { request, calls };
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await Promise.all([Order.syncIndexes(), SkuMapping.syncIndexes(), WebhookEvent.syncIndexes()]);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('order windows never exceed the Myntra 7-day limit', () => {
  const windows = orderWindows('2026-09-01', '2026-09-30');
  assert.equal(windows[0].startDate, '2026-09-01');
  assert.equal(windows.at(-1).endDate, '2026-09-30');
  windows.forEach((w) => {
    const days = (new Date(w.endDate) - new Date(w.startDate)) / 864e5;
    assert.ok(days <= 6, `${w.startDate}..${w.endDate}`);
  });
});

test('client generates a token once, reuses it, and refreshes on 401', async () => {
  const saved = [];
  let first = true;
  const calls = [];
  const request = async (method, url, opts) => {
    calls.push({ url, headers: opts.headers });
    const path = new URL(url).pathname;
    if (path === '/authorization/generate_token') return reply(200, {}, { access_token: 'acc-1', refresh_token: 'ref-1' });
    if (path === '/authorization/refresh_token') {
      assert.equal(opts.headers.refresh_token, 'ref-1');
      return reply(200, {}, { access_token: 'acc-2', refresh_token: 'ref-2' });
    }
    if (first && opts.headers.access_token === 'acc-1' && path.includes('/order/A')) {
      first = false;
      return reply(401, { statusMessage: 'expired' });
    }
    return reply(200, { sellerOrderId: 'x', token: opts.headers.access_token, store: opts.headers['x-partner-store'] });
  };
  const client = createMyntraClient(
    { merchantId: 'M1', secretKey: 'S1' },
    { request, saveTokens: async (t) => saved.push(t) },
  );
  const a = await client.getOrder('B');
  const b = await client.getOrder('A');
  assert.equal(a.token, 'acc-1');
  assert.equal(a.store, 'myntra');
  assert.equal(b.token, 'acc-2');
  assert.equal(calls.filter((c) => c.url.endsWith('/generate_token')).length, 1);
  assert.equal(saved.length, 2);
  assert.equal(saved[1].refreshToken, 'ref-2');
});

test('cached token is used without calling generate_token', async () => {
  const { request, calls } = fakeMyntra({ orders: [], details: {} });
  const client = createMyntraClient(
    { merchantId: 'M1', secretKey: 'S1', accessToken: 'cached', refreshToken: 'r', tokenIssuedAt: new Date().toISOString() },
    { request },
  );
  await client.listOrderRefs({ from: '2026-10-01', to: '2026-10-03' });
  assert.equal(calls.some((c) => c.url.includes('/authorization/')), false);
  assert.equal(calls[0].headers.access_token, 'cached');
});

test('product list uses catalog search and explains a 403', async () => {
  const request = async (method, url) => {
    const path = new URL(url).pathname;
    if (path === '/authorization/generate_token') return reply(200, {}, { access_token: 'acc', refresh_token: 'ref' });
    if (path === '/partner/catalog/v2/product/search/nofilter') {
      return reply(403, { statusCode: 403, statusType: 'ERROR', statusMessage: 'This request is not valid' });
    }
    return reply(404, { statusMessage: 'not found' });
  };
  const client = createMyntraClient({ merchantId: 'M1', secretKey: 'S1' }, { request });
  await assert.rejects(() => client.listProducts(), /Catalog reconciliation is not enabled/);
});

test('inventory search explains a 403 on a real seller SKU', async () => {
  const request = async (method, url) => {
    const path = new URL(url).pathname;
    if (path === '/authorization/generate_token') return reply(200, {}, { access_token: 'acc', refresh_token: 'ref' });
    if (path === '/partner/v4/inventory/search') {
      return reply(403, { statusCode: 403, statusType: 'ERROR', statusMessage: 'This request is not valid' });
    }
    return reply(404, { statusMessage: 'not found' });
  };
  const client = createMyntraClient({ merchantId: 'M1', secretKey: 'S1' }, { request });
  await assert.rejects(() => client.searchInventory(['LEHE2405']), /Inventory reconciliation is not enabled/);
});

test('inventory update is sent in batches of 10 with the store code', async () => {
  const { request, calls } = fakeMyntra({ orders: [], details: {} });
  const client = createMyntraClient({ merchantId: 'M1', secretKey: 'S1' }, { request });
  const items = Array.from({ length: 23 }, (_, i) => ({ sku: `SKU${i}`, quantity: i }));
  await client.updateInventory(items, { storeCode: 'C55185W28092' });
  const pushes = calls.filter((c) => c.url.endsWith('/inventory/update'));
  assert.deepEqual(pushes.map((c) => c.body.length), [10, 10, 3]);
  assert.equal(pushes[0].body[0].store_code, 'C55185W28092');
  assert.equal(pushes[0].method, 'PUT');
});

test('PDF bytes are unwrapped from the multipart label envelope', () => {
  const wrapped = Buffer.from('--uuid:1\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 body %%EOF\r\n--uuid:1--');
  assert.equal(extractPdf(wrapped).toString(), '%PDF-1.4 body %%EOF');
  assert.throws(() => extractPdf(Buffer.from('<html>error</html>')), /PDF/);
});

test('status mapping and Myntra date parsing', () => {
  assert.equal(orderStatus([{ status: 'IC' }, { status: 'IC' }]), 'Cancelled');
  assert.equal(orderStatus([{ status: 'IC' }, { status: 'SH' }]), 'Dispatched');
  assert.equal(orderStatus([{ status: 'WP' }, { status: 'SH' }]), 'Processing');
  assert.equal(orderStatus([{ status: 'PK' }]), 'Ready to Ship');
  assert.equal(orderStatus([{ status: 'S' }, { status: 'C' }]), 'Dispatched');
  assert.equal(orderStatus([{ status: 'C' }]), 'Delivered');
  assert.equal(parseMyntraDate('05-10-2026 10:15:00').toISOString(), '2026-10-05T04:45:00.000Z');
});

test('mapper builds an OMS order with items, tax, AWB and channel lines', () => {
  const mapped = mapMyntraOrder('9001', [detail('S-1', [{ sku: 'LEHE1', status_code: 'SH', packetId: 'P1', invoiceNumber: 'INV1' }])]);
  assert.equal(mapped.orderNo, 'MYN-9001');
  assert.equal(mapped.channel, 'Myntra');
  assert.equal(mapped.status, 'Dispatched');
  assert.equal(mapped.paymentMode, 'COD');
  assert.equal(mapped.awb, 'MYEC123');
  assert.equal(mapped.invoiceNo, 'INV1');
  assert.equal(mapped.items[0].gst, 5);
  assert.equal(mapped.channelLines[0].packetId, 'P1');
  assert.equal(mapped.city, 'Jaipur, Rajasthan, 302001');
});

test('order pull is idempotent and turns Myntra SKUs into masters', async () => {
  const tenant = await Tenant.create({ name: 'Myntra shop', slug: `myn-${Date.now()}`, kind: 'merchant' });
  const orders = [
    { orderId: 101, orderLines: [{ orderLineId: 1, sellerOrderId: 'S-101' }] },
    { orderId: 102, orderLines: [{ orderLineId: 2, sellerOrderId: 'S-102' }] },
    { orderId: 103, orderLines: [{ orderLineId: 3, sellerOrderId: 'S-103a' }, { orderLineId: 4, sellerOrderId: 'S-103b' }] },
  ];
  const details = {
    'S-101': detail('S-101', [{ sku: 'LEHE1', status_code: 'WP' }]),
    'S-102': detail('S-102', [{ sku: 'LEHE2', status_code: 'IC' }]),
    'S-103a': detail('S-103a', [{ sku: 'LEHE1', status_code: 'SH' }]),
    'S-103b': detail('S-103b', [{ sku: 'LEHE3', status_code: 'DL' }]),
  };
  const fake = fakeMyntra({ orders, details });
  const client = createMyntraClient({ merchantId: 'M1', secretKey: 'S1' }, { request: fake.request });

  const first = await pullMyntraOrders(tenant._id, { client, from: '2026-10-01', to: '2026-10-05' });
  assert.equal(first.fetched, 3);
  assert.equal(first.created, 3);
  assert.equal(first.failed, 0);

  const second = await pullMyntraOrders(tenant._id, { client, from: '2026-10-01', to: '2026-10-05' });
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 3);

  const rows = await Order.find({ tenantId: tenant._id }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(rows.length, 3);
  const multi = rows.find((r) => r.orderNo === 'MYN-103');
  assert.equal(multi.items.length, 2);
  assert.equal(multi.status, 'Dispatched');
  assert.equal(rows.find((r) => r.orderNo === 'MYN-102').status, 'Cancelled');
  assert.equal(multi.source, 'channel_api');

  const maps = await SkuMapping.find({ tenantId: tenant._id, channel: 'myntra' }).setOptions({ skipTenantFilter: true }).lean();
  assert.deepEqual(maps.map((m) => m.channelSkuCode).sort(), ['LEHE1', 'LEHE2', 'LEHE3']);
  assert.ok(maps.every((m) => m.syncStatus === 'synced' && m.masterSkuId));
  const masters = await MasterSku.find({ tenantId: tenant._id }).setOptions({ skipTenantFilter: true }).lean();
  assert.deepEqual(masters.map((m) => m.code).sort(), ['LEHE1', 'LEHE2', 'LEHE3']);
  assert.equal(masters.find((m) => m.code === 'LEHE1').mrp, 2000);


  details['S-101'] = detail('S-101', [{ sku: 'LEHE1', status_code: 'PK', packetId: 'P-9' }]);
  const third = await pullMyntraOrders(tenant._id, { client, from: '2026-10-01', to: '2026-10-05' });
  assert.equal(third.updated, 1);
  const moved = await Order.findOne({ tenantId: tenant._id, orderNo: 'MYN-101' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(moved.status, 'Ready to Ship');
  assert.equal(moved.channelLines[0].packetId, 'P-9');
});

test('scheduler queues one Myntra pull per connected tenant and skips when one is open', async () => {
  const IntegrationJob = require('../src/models/IntegrationJob');
  const { enqueueScheduledPulls } = require('../src/services/channelScheduler.service');
  const tenant = await Tenant.create({ name: 'Sched shop', slug: `sched-${Date.now()}`, kind: 'merchant' });
  await upsertConnection(tenant._id, null, 'myntra', { credentials: { merchantId: 'M9', secretKey: 'S9' } });
  await enqueueScheduledPulls();
  await enqueueScheduledPulls();
  const jobs = await IntegrationJob.find({ tenantId: tenant._id, jobType: 'orders_pull' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].triggeredBy, 'scheduler');
  assert.ok(jobs[0].payload.from);
  await IntegrationJob.deleteMany({ tenantId: tenant._id }).setOptions({ skipTenantFilter: true });
});

test('storefront push: token auth, idempotent create order, Myntra response codes', async () => {
  const tenant = await Tenant.create({ name: 'Push shop', slug: `push-${Date.now()}`, kind: 'merchant' });
  await upsertConnection(tenant._id, null, 'myntra', {
    credentials: { merchantId: 'M1', secretKey: 'S1', token: 'push-token-1' },
  });
  const url = `${base}/api/v1/integrations/myntra/storefront/v4/order/S-777`;
  const payload = detail('S-777', [{ sku: 'LEHE9', status_code: 'WP' }]);

  const denied = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', access_token: 'wrong' },
    body: JSON.stringify(payload),
  });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).statusType, 'ERROR');

  for (let i = 0; i < 2; i += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', access_token: 'push-token-1' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).statusCode, 1006);
  }
  const rows = await Order.find({ tenantId: tenant._id }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channelLines[0].sellerOrderId, 'S-777');
  const event = await WebhookEvent.findOne({ tenantId: tenant._id, externalEventId: 'order:S-777' })
    .setOptions({ skipTenantFilter: true }).lean();
  assert.equal(event.duplicateCount, 1);

  const ret = await fetch(`${base}/api/v1/integrations/myntra/storefront/v4/return/cus_1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', access_token: 'push-token-1' },
    body: JSON.stringify({ id: 'cus_1', type: 'CUSTOMER_RETURN', status: 'CONFIRMED', sellerOrderId: 'S-777', reason: 'Size' }),
  });
  assert.equal((await ret.json()).statusCode, 1006);
  const withReturn = await Order.findById(rows[0]._id).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(withReturn.reversePickup.returnId, 'cus_1');
});
