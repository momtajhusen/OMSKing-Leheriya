process.env.NODE_ENV = 'test';
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const Order = require('../src/models/Order');
const CustomerReturn = require('../src/models/CustomerReturn');
const { buildOrderSummary, dayKey, netSales, grossSales } = require('../src/services/orderSummary.service');
const { isRto, shippingTab } = require('../src/lib/orderTabs');
const { periodKey, monthBounds, monthEnd } = require('../src/services/subscription.service');

const DAY = 24 * 60 * 60 * 1000;
let replSet;
let server;
let base;

async function api(path, token) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

async function login(email) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.data.accessToken;
}

async function shop(name) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return provisionMerchant({
    name,
    ownerEmail: `money-${stamp}@example.com`,
    ownerName: 'Money Owner',
    password: 'Password1',
    status: 'active',
  });
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

const now = new Date().toISOString();
const row = (id, extra = {}) => ({
  id, status: 'Delivered', total: 0, channel: 'Shopify', createdAt: now, items: [], subOrders: [], ...extra,
});

test('net sales drop Cancelled and RTO orders and subtract refunded returns; gross keeps RTO', () => {
  const orders = [
    row('A', { total: 0.1 }),
    row('B', { total: 0.2 }),
    row('C', { status: 'Cancelled', total: 500 }),
    row('D', { status: 'Dispatched', total: 300, channelStatus: 'RTO' }),
    row('E', { status: 'RTO In Transit', total: 200 }),
    row('F', { total: 1000, channel: 'Amazon' }),
  ];
  const returnRows = [
    { orderNo: 'F', status: 'Completed', refundStatus: 'refunded', refundAmount: 250.45 },
    { orderNo: 'F', status: 'Pending', refundStatus: 'pending', refundAmount: 99 },
    { orderNo: 'D', status: 'Completed', refundStatus: 'refunded', refundAmount: 300 },
  ];
  const summary = buildOrderSummary(orders, {
    returnRows, series: [{ id: 'shopify', label: 'Shopify' }, { id: 'amazon', label: 'Amazon' }],
  });
  assert.equal(summary.revenue, 749.85);
  assert.equal(summary.grossSales, 1500.3);
  const amazon = summary.channels.find((entry) => entry.channel === 'Amazon');
  assert.equal(amazon.revenue, 749.55);
  assert.equal(amazon.grossSales, 1000);
  assert.equal(summary.channels.find((entry) => entry.channel === 'Shopify').revenue, 0.3);

  const refunds = new Map([['F', 250.45]]);
  assert.equal(netSales(orders, refunds), 749.85);
  assert.equal(grossSales(orders), 1500.3);
});

test('recent orders sort by time even when createdAt is a Date object', () => {
  const orders = [
    row('OLD-TUE', { createdAt: new Date('2026-10-27T10:00:00.000Z') }),
    row('NEW-MON', { createdAt: new Date('2026-11-02T10:00:00.000Z') }),
    row('MID-WED', { createdAt: new Date('2026-10-28T10:00:00.000Z') }),
  ];
  const summary = buildOrderSummary(orders, { days: 'all' });
  assert.deepEqual(summary.recent.all.map((entry) => entry.id), ['NEW-MON', 'MID-WED', 'OLD-TUE']);
});

test('one shared RTO / shipping-tab rule', () => {
  assert.equal(isRto({ status: 'Dispatched', channelStatus: 'RTO' }), true);
  assert.equal(isRto({ status: 'Cancelled', channelLines: [{ status: 'RTO' }] }), true);
  assert.equal(isRto({ status: 'RTO In Transit' }), true);
  assert.equal(isRto({ status: 'Ready to Ship' }), false);
  assert.equal(shippingTab({ id: 'X', status: 'Dispatched', channelStatus: 'RTO' }), 'RTO');
  assert.equal(shippingTab({ id: 'X', status: 'Dispatched' }), 'In Transit');
  assert.equal(shippingTab({ id: 'X', status: 'Dispatched' }, new Set(['X'])), 'Pickup & Manifest');
  assert.equal(shippingTab({ id: 'X', status: 'New' }), '');
});

test('dashboard Dispatched / Delivered tabs use the shipping tabs: RTO orders are not counted there', () => {
  const orders = [
    row('SHIP', { status: 'Dispatched' }),
    row('SHIP-RTO', { status: 'Dispatched', channelStatus: 'RTO' }),
    row('DEL'),
    row('DEL-RTO', { channelLines: [{ status: 'RTO' }] }),
  ];
  const summary = buildOrderSummary(orders, { days: 'all' });
  assert.equal(summary.counts.Dispatched, 1);
  assert.equal(summary.counts.Delivered, 1);
  assert.deepEqual(summary.recent.Dispatched.map((entry) => entry.id), ['SHIP']);
});

test('45-day Return issues / Problem invoices clocks start at dispatch, not at the order date', () => {
  const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
  const orders = [
    row('LATE-PICKUP', { status: 'Dispatched', createdAt: ago(60), pickedUpAt: ago(10) }),
    row('OLD-PICKUP', { status: 'Dispatched', createdAt: ago(60), pickedUpAt: ago(50) }),
    row('LATE-LABEL', { status: 'Dispatched', createdAt: ago(60), labelGeneratedAt: ago(5) }),
    row('NO-DATES', { status: 'Dispatched', createdAt: ago(60) }),
    row('INV-LATE', { createdAt: ago(60), pickedUpAt: ago(10), invoiceNo: 'I1' }),
    row('INV-OLD', { createdAt: ago(60), pickedUpAt: ago(50), invoiceNo: 'I2' }),
  ];
  const summary = buildOrderSummary(orders, { days: 'all' });
  assert.equal(summary.returns, 2);
  assert.equal(summary.missingInvoice, 1);
});

test('tzOffset is clamped and days are capped so bad input cannot throw or spin', () => {
  assert.equal(dayKey('2026-10-20T10:00:00.000Z', 1e15), dayKey('2026-10-20T10:00:00.000Z', 840));
  assert.equal(dayKey('2026-10-20T10:00:00.000Z', 'abc'), '2026-10-20');
  assert.doesNotThrow(() => buildOrderSummary([row('A')], { tzOffset: 1e15, days: '7' }));
  const started = Date.now();
  const wide = buildOrderSummary([row('A')], { days: '100000000' });
  assert.ok(Date.now() - started < 2000);
  assert.equal(wide.trend.length, 366);
  assert.equal(buildOrderSummary([row('A')], { days: '-5' }).trend.length, 1);
});

test('custom range with only an old from: KPIs and trend cover the same capped 366 days', () => {
  const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
  const orders = [row('RECENT', { createdAt: ago(2), total: 10 }), row('ANCIENT', { createdAt: ago(800), total: 99 })];
  const from = new Date(Date.now() - 900 * DAY).toISOString().slice(0, 10);
  const summary = buildOrderSummary(orders, { from, tzOffset: 0 });
  assert.equal(summary.trend.length, 366);
  assert.equal(summary.total, 1);
  assert.equal(summary.revenue, 10);
  assert.equal(summary.range.capped, true);
});

test('billing month and plan expiry are computed in Asia/Kolkata, not server time', () => {
  // 31 Oct 19:00 UTC is 1 Nov 00:30 IST.
  const instant = new Date('2026-10-31T19:00:00.000Z');
  assert.equal(periodKey(instant), '2026-11');
  const { start, end } = monthBounds(instant);
  assert.equal(start.toISOString(), '2026-10-31T18:30:00.000Z');
  assert.equal(end.toISOString(), '2026-11-30T18:30:00.000Z');
  assert.equal(monthEnd(instant).toISOString(), '2026-11-30T18:29:59.999Z');
  assert.equal(periodKey(new Date('2026-10-31T18:00:00.000Z')), '2026-10');
});

test('orders list tab counts follow the channel, date, payment and search filters (not the status tab)', async () => {
  const merchant = await shop('Count filters shop');
  const tenantId = merchant.tenant._id;
  const at = (day) => new Date(`2026-10-${day}T10:00:00.000Z`);
  const seed = { tenantId, channel: 'Shopify', source: 'manual', paymentMode: 'COD', items: [{ name: 'Kurta', sku: 'K1', qty: 1, price: 100 }] };
  await Order.create([
    { ...seed, orderNo: 'F-S-DEL-20', status: 'Delivered', awb: 'A1', orderDate: at(20), paymentMode: 'Prepaid', total: 100 },
    { ...seed, orderNo: 'F-S-DEL-25', status: 'Delivered', awb: 'A2', orderDate: at(25), paymentMode: 'Prepaid', total: 200.2 },
    { ...seed, orderNo: 'F-A-DEL-20', channel: 'Amazon', status: 'Delivered', awb: 'A3', orderDate: at(20), total: 0.1 },
    { ...seed, orderNo: 'F-S-CAN-20', status: 'Cancelled', orderDate: at(20), total: 500 },
    { ...seed, orderNo: 'F-S-RTO-20', status: 'Dispatched', awb: 'A4', channelStatus: 'RTO', orderDate: at(20), total: 300 },
    { ...seed, orderNo: 'F-S-SHIP-20', status: 'Dispatched', awb: 'A5', orderDate: at(20), total: 50 },
  ]);
  await CustomerReturn.create([
    { tenantId, returnNo: 'RET-M1', orderNo: 'F-S-DEL-20', refundStatus: 'refunded', refundAmount: 30 },
    { tenantId, returnNo: 'RET-M2', orderNo: 'F-S-DEL-25', refundStatus: 'pending', refundAmount: 50 },
  ]);
  const token = await login(merchant.owner.email);
  const list = async (query) => {
    const res = await api(`/api/v1/orders?limit=50&${query}`, token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return { ids: res.body.data.map((item) => item.orderNo).sort(), counts: res.body.meta.counts };
  };

  const scoped = await list('status=Delivered&channel=Shopify&from=2026-10-20&to=2026-10-20&tzOffset=0');
  assert.deepEqual(scoped.ids, ['F-S-DEL-20']);
  assert.equal(scoped.counts.total, 4);
  assert.equal(scoped.counts.Delivered, 1);
  assert.equal(scoped.counts.RTO, 1);
  assert.equal(scoped.counts['In Transit'], 1);

  const prepaid = await list('payment=Prepaid');
  assert.equal(prepaid.counts.total, 2);
  assert.equal(prepaid.counts.Delivered, 2);

  const searched = await list('q=F-S-RTO');
  assert.equal(searched.counts.total, 1);
  assert.equal(searched.counts.RTO, 1);

  const huge = await api('/api/v1/orders?limit=50&from=2026-10-20&tzOffset=99999999999999', token);
  assert.equal(huge.status, 200, JSON.stringify(huge.body));

  const all = await list('status=all');
  const summary = await api('/api/v1/orders/summary?days=all&tzOffset=0', token);
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  const data = summary.body.data;
  assert.equal(data.counts.Dispatched, all.counts['Pickup & Manifest'] + all.counts['In Transit']);
  assert.equal(data.counts.Delivered, all.counts.Delivered);
  assert.equal(data.grossSales, 650.3);
  assert.equal(data.revenue, 320.3);
});
