process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { als } = require('../src/lib/tenantContext');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Vendor = require('../src/models/Vendor');
const Warehouse = require('../src/models/Warehouse');
const CustomerReturn = require('../src/models/CustomerReturn');
const finance = require('../src/services/finance.service');
const delhivery = require('../src/adapters/couriers/delhivery');
const { manifestRow } = require('../src/services/handover.service');
const { codCollectAmount, isPaid, isCodLike } = require('../src/utils/payment');
const { updateRefund } = require('../src/services/returnsFlow.service');
const { bookShopify } = require('../src/services/ship.service');
const financeController = require('../src/controllers/finance.controller');
const orders = require('../src/controllers/orders.controller');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

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
  await als.run({ tenantId: String(tenant._id), skipTenantFilter: false, userId: null }, () => handler({
    tenantId: String(tenant._id),
    user: { id: null, role: 'super_admin' },
    params: {},
    query: {},
    body: {},
    ...req,
  }, res));
  return res.body?.data;
}

function vendorReq(vendorId, extra = {}) {
  return {
    user: { id: null, role: 'vendor', assignedVendorIds: [vendorId] },
    vendorScope: { active: true, assignedVendorIds: [String(vendorId)] },
    ...extra,
  };
}

async function newTenant(name) {
  return Tenant.create({ name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: 'merchant' });
}

// ---------- helpers ----------

test('codCollectAmount: COD-like collects codAmount or total; prepaid, pickup and void collect 0', () => {
  assert.equal(codCollectAmount({ paymentMode: 'COD', total: 1000 }), 1000);
  assert.equal(codCollectAmount({ paymentMode: 'COD', total: 1000, codAmount: null }), 1000);
  assert.equal(codCollectAmount({ paymentMode: 'Partially paid', total: 1000, codAmount: 300 }), 300);
  assert.equal(codCollectAmount({ paymentMode: 'Cash on Delivery', total: 999.995 }), 1000);
  assert.equal(codCollectAmount({ paymentMode: 'Prepaid', total: 1000, codAmount: 300 }), 0);
  assert.equal(codCollectAmount({ paymentMode: 'Pickup', total: 1000 }), 0);
  assert.equal(codCollectAmount({ paymentMode: 'Void', total: 1000 }), 0);
  assert.equal(codCollectAmount({ paymentMode: 'COD', total: 1000, get: (path) => (path === 'codAmount' ? 250 : undefined) }), 250);
  assert.equal(isCodLike('Partially paid'), true);
  assert.equal(isCodLike('Prepaid'), false);
});

test('Delhivery booking sends cod_amount: collect amount for COD, 0 for Prepaid and Pickup', async () => {
  const bodies = [];
  const request = async (method, url, opts) => {
    bodies.push(JSON.parse(decodeURIComponent(String(opts.body).replace(/^format=json&data=/, ''))));
    return { status: 200, text: JSON.stringify({ packages: [{ waybill: 'AWB-T', status: 'Success' }] }) };
  };
  const creds = { apiToken: 'dlv-test', pickupWarehouse: 'WH-001' };
  const base = { name: 'A', address: 'X', pincode: '302001', orderNo: 'O-1', amount: 1000, quantity: 1 };
  await delhivery.book(creds, { ...base, paymentMode: 'COD', codAmount: 300 }, { request });
  await delhivery.book(creds, { ...base, paymentMode: 'COD' }, { request });
  await delhivery.book(creds, { ...base, paymentMode: 'Prepaid', codAmount: 300 }, { request });
  await delhivery.book(creds, { ...base, paymentMode: 'Pickup' }, { request });
  const [cod, codFull, prepaid, pickup] = bodies.map((body) => body.shipments[0]);
  assert.equal(cod.cod_amount, 300);
  assert.equal(cod.total_amount, 1000);
  assert.equal(codFull.cod_amount, 1000);
  assert.equal(prepaid.cod_amount, 0);
  assert.equal(pickup.cod_amount, 0);
});

test('handover manifest row uses the same COD-like test and collect amount', () => {
  assert.equal(manifestRow({ orderNo: 'H1', paymentMode: 'Partially paid', total: 1000, codAmount: 400 }).codAmount, 400);
  assert.equal(manifestRow({ orderNo: 'H2', paymentMode: 'Cash on Delivery', total: 800 }).codAmount, 800);
  assert.equal(manifestRow({ orderNo: 'H3', paymentMode: 'Prepaid', total: 800 }).codAmount, 0);
});

test('isPaid / paymentStanding: Shopify checkout-paid is paid; Shopify COD stays "Partially paid" until money is recorded (docs/08-DOMAIN-RULES.md)', () => {
  assert.equal(isPaid({ paymentStatus: 'paid' }), true);
  assert.equal(isPaid({ channel: 'Shopify', paymentMode: 'Prepaid', sourceOrderData: { financial_status: 'paid' } }), true);
  assert.equal(isPaid({ channel: 'Shopify', paymentMode: 'Prepaid', sourceOrderData: { financial_status: 'pending' } }), false);
  assert.equal(isPaid({ channel: 'Amazon', sourceOrderData: { financial_status: 'paid' } }), false);
  const cod = finance.paymentStanding({ channel: 'Shopify', paymentMode: 'COD', paymentStatus: '' });
  assert.equal(cod.label, 'Partially paid');
  assert.equal(cod.paid, false);
  assert.equal(finance.paymentStanding({ channel: 'Amazon', paymentMode: 'COD' }).label, 'Unpaid');
  const partial = finance.paymentStanding({ channel: 'Shopify', paymentMode: 'Partially paid' });
  assert.equal(partial.label, 'Partially paid');
  const checkout = finance.paymentStanding({ channel: 'Shopify', paymentMode: 'Prepaid', sourceOrderData: { financial_status: 'paid' } });
  assert.equal(checkout.paid, true);
});

// ---------- settlement ----------

test('settlement amounts: bracket negatives parse as minus', () => {
  assert.equal(finance.parseAmount('(500)'), -500);
  assert.equal(finance.parseAmount('₹1,234.50'), 1234.5);
  assert.equal(finance.parseAmount('-20'), -20);
  assert.equal(finance.parseAmount(''), 0);
});

test('settlement: gross that does not match the order total is an amount mismatch, not paid', () => {
  const rows = finance.matchSettlement([{ orderNo: 'AMZ-1', total: 1000 }], [
    'order,gross,commission,net',
    'AMZ-1,600,60,540',
  ].join('\n'));
  assert.equal(rows[0].status, 'exception');
  assert.match(rows[0].exception, /amount mismatch/i);
});

test('settlement: no net column is an exception, not net = expected', () => {
  const rows = finance.matchSettlement([{ orderNo: 'AMZ-1', total: 1000 }], [
    'order,gross,commission',
    'AMZ-1,1000,100',
  ].join('\n'));
  assert.equal(rows[0].status, 'exception');
  assert.match(rows[0].exception, /no net amount/i);
});

test('settlement: gross missing falls back to net + deductions, never to the order total', () => {
  const ok = finance.matchSettlement([{ orderNo: 'AMZ-1', total: 1000 }], [
    'order,commission,fees,net',
    'AMZ-1,100,(0),900',
  ].join('\n'));
  assert.equal(ok[0].status, 'matched');
  const short = finance.matchSettlement([{ orderNo: 'AMZ-1', total: 1000 }], [
    'order,commission,net',
    'AMZ-1,100,500',
  ].join('\n'));
  assert.equal(short[0].status, 'exception');
  assert.match(short[0].exception, /amount mismatch/i);
});

test('settlement: refund-only rows are refund rows and never mark paid', () => {
  const rows = finance.matchSettlement([{ orderNo: 'AMZ-2', total: 500 }], [
    'order,gross,refunds,net',
    'AMZ-2,0,500,(500)',
  ].join('\n'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'refund');
  assert.notEqual(rows[0].status, 'matched');
});

test('settlement: several rows of one order are summed before comparing', () => {
  const rows = finance.matchSettlement([{ orderNo: 'AMZ-3', total: 1000 }], [
    'order,gross,commission,fees,net',
    'AMZ-3,600,60,0,540',
    'AMZ-3,400,40,0,360',
    'AMZ-3,0,0,10,(10)',
  ].join('\n'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'matched');
  assert.equal(rows[0].orderNo, 'AMZ-3');
  assert.equal(rows[0].lines, 3);
  assert.equal(rows[0].net, 890);
  assert.ok(!rows.some((row) => /No Master Order/.test(row.exception)));
});

test('settlement: matching is limited to the file channel and reads Myntra packet / seller order ids', () => {
  const pool = [
    { orderNo: 'SHP-1', channel: 'Shopify', total: 1000 },
    { orderNo: 'MYN-7', channel: 'Myntra', total: 700, channelLines: [{ sellerOrderId: 'SO-7', packetId: 'PK-7' }] },
  ];
  const other = finance.matchSettlement(pool, ['order,gross,net', 'SHP-1,1000,1000'].join('\n'), { source: 'myntra', channel: 'Myntra' });
  assert.equal(other[0].status, 'exception');
  assert.match(other[0].exception, /No Master Order/);
  const packet = finance.matchSettlement(pool, ['packet_id,gross,net', 'PK-7,700,700'].join('\n'), { source: 'myntra', channel: 'Myntra' });
  assert.equal(packet[0].status, 'matched');
  assert.equal(packet[0].orderNo, 'MYN-7');
  const seller = finance.matchSettlement(pool, ['seller_order_id,gross,net', 'SO-7,700,700'].join('\n'), { source: 'myntra', channel: 'Myntra' });
  assert.equal(seller[0].orderNo, 'MYN-7');
});

test('courier bill: billed COD collect amount must equal the order collect amount; COD charge on prepaid is flagged', () => {
  const csv = [
    'awb,charged_weight,declared_weight,cod,cod_amount,amount',
    'AWB-1,0.5,0.5,30,1000,50',
    'AWB-2,0.5,0.5,30,300,50',
    'AWB-3,0.5,0.5,30,,50',
    'AWB-4,0.5,0.5,0,,40',
  ].join('\n');
  const rows = finance.matchCourierBill(csv, { codByAwb: new Map([['AWB-1', 300], ['AWB-2', 300], ['AWB-3', 0], ['AWB-4', 0]]) });
  assert.equal(rows[0].status, 'exception');
  assert.match(rows[0].exception, /COD/);
  assert.equal(rows[1].status, 'matched');
  assert.equal(rows[2].status, 'exception');
  assert.match(rows[2].exception, /prepaid/i);
  assert.equal(rows[3].status, 'matched');
});

// ---------- controllers (DB) ----------

test('settlement endpoint: only a matching amount marks paid, scoped to the tenant, and a re-import is 409', async () => {
  const tenant = await newTenant('Settle shop');
  const other = await newTenant('Other settle shop');
  const base = { channel: 'Amazon', source: 'manual', status: 'Delivered' };
  await Order.create([
    { ...base, tenantId: tenant._id, orderNo: 'AMZ-OK', total: 1000 },
    { ...base, tenantId: tenant._id, orderNo: 'AMZ-SHORT', total: 1000 },
    { ...base, tenantId: tenant._id, orderNo: 'SHP-X', channel: 'Shopify', total: 500 },
    { ...base, tenantId: other._id, orderNo: 'AMZ-OK', total: 1000 },
  ]);
  const csv = [
    'order,gross,commission,net',
    'AMZ-OK,1000,100,900',
    'AMZ-SHORT,400,40,360',
    'SHP-X,500,0,500',
  ].join('\n');
  const data = await call(tenant, financeController.matchSettlement, { body: { source: 'amazon', csv } });
  assert.equal(data.rows.find((row) => row.orderNo === 'AMZ-OK').status, 'matched');
  assert.match(data.rows.find((row) => row.key === 'AMZ-SHORT').exception, /amount mismatch/i);
  assert.match(data.rows.find((row) => row.key === 'SHP-X').exception, /No Master Order/);
  const paid = await Order.find({ tenantId: tenant._id, paymentStatus: 'paid' }).setOptions({ skipTenantFilter: true }).lean();
  assert.deepEqual(paid.map((row) => row.orderNo), ['AMZ-OK']);
  const theirs = await Order.findOne({ tenantId: other._id, orderNo: 'AMZ-OK' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(theirs.paymentStatus, '');
  await assert.rejects(
    () => call(tenant, financeController.matchSettlement, { body: { source: 'amazon', csv: `${csv}\r\n` } }),
    (err) => err.statusCode === 409,
  );
  const again = await call(other, financeController.matchSettlement, { body: { source: 'amazon', csv } });
  assert.equal(again.rows.find((row) => row.orderNo === 'AMZ-OK').status, 'matched');
});

test('finance endpoints honour the vendor scope', async () => {
  const tenant = await newTenant('Vendor finance shop');
  const mine = await Vendor.create({ tenantId: tenant._id, name: 'Vendor A', nameNorm: 'vendor a', phone: '9811100011' });
  await Vendor.create({ tenantId: tenant._id, name: 'Vendor B', nameNorm: 'vendor b', phone: '9811100012' });
  const sub = (id, vendor, price) => ({ id, index: 1, sku: 'K', title: 'K', qty: 1, price, assignedVendor: vendor });
  await Order.create([
    { tenantId: tenant._id, orderNo: 'AMZ-VA', channel: 'Amazon', source: 'manual', status: 'Delivered', total: 700, subOrders: [sub('AMZ-VA-1', 'Vendor A', 700)] },
    { tenantId: tenant._id, orderNo: 'AMZ-VB', channel: 'Amazon', source: 'manual', status: 'Delivered', total: 900, subOrders: [sub('AMZ-VB-1', 'Vendor B', 900)] },
  ]);
  const report = await call(tenant, financeController.salesReport, vendorReq(mine._id));
  assert.equal(report.orders, 1);
  assert.equal(report.netSalesPaise, 70000);
  const csv = ['order,gross,net', 'AMZ-VB,900,900'].join('\n');
  const data = await call(tenant, financeController.matchSettlement, vendorReq(mine._id, { body: { source: 'amazon', csv } }));
  assert.equal(data.rows[0].status, 'exception');
  const vb = await Order.findOne({ tenantId: tenant._id, orderNo: 'AMZ-VB' }).setOptions({ skipTenantFilter: true }).lean();
  assert.equal(vb.paymentStatus, '');
});

test('courier bill endpoint compares billed COD with the order found by AWB in this tenant only', async () => {
  const tenant = await newTenant('Bill shop');
  const other = await newTenant('Other bill shop');
  await Order.create([
    { tenantId: tenant._id, orderNo: 'B-1', channel: 'Shopify', source: 'manual', paymentMode: 'COD', total: 1000, awb: 'AWB-B1' },
    { tenantId: other._id, orderNo: 'B-1', channel: 'Shopify', source: 'manual', paymentMode: 'COD', total: 500, awb: 'AWB-B2' },
  ]);
  const csv = [
    'awb,charged_weight,declared_weight,cod,cod_amount,amount',
    'AWB-B1,0.5,0.5,30,500,50',
    'AWB-B2,0.5,0.5,30,500,50',
  ].join('\n');
  const data = await call(tenant, financeController.matchCourierBill, { body: { csv } });
  assert.equal(data.rows[0].status, 'exception');
  assert.match(data.rows[0].exception, /COD/);
  assert.equal(data.rows[1].status, 'matched', 'another tenant AWB is not looked up');
});

test('orders list marks a Shopify checkout-paid order as paid (same helper as reconciliation)', async () => {
  const tenant = await newTenant('Paid list shop');
  await Order.create({
    tenantId: tenant._id, orderNo: 'SHP-PAIDCHK', channel: 'Shopify', source: 'manual', status: 'Delivered', paymentMode: 'Prepaid', total: 900,
    sourceOrderData: { id: '1', financial_status: 'paid', gateways: ['razorpay'] },
  });
  const rows = await call(tenant, orders.listOrders, { query: { status: 'all' } });
  const row = rows.find((item) => item.orderNo === 'SHP-PAIDCHK');
  assert.equal(row.paid, true);
  assert.equal(row.sourceOrderData?.gateways, undefined, 'the raw channel payload stays out of the list');
});

test('courier manifest shows the partially paid collect amount, not the full total', async () => {
  const tenant = await newTenant('Manifest pay shop');
  const day = '2026-11-03';
  const at = new Date('2026-11-03T10:00:00+05:30');
  const doc = await Order.create({
    tenantId: tenant._id, orderNo: 'MP-1', channel: 'Shopify', source: 'manual', status: 'Ready to Ship', courier: 'Delhivery',
    awb: 'AWB-MP1', paymentMode: 'Partially paid', total: 1000, labelGeneratedAt: at,
    items: [{ name: 'K', sku: 'K', qty: 1, price: 1000, masterSkuId: new mongoose.Types.ObjectId() }],
  });
  await Order.collection.updateOne({ _id: doc._id }, { $set: { codAmount: 350 } });
  const data = await call(tenant, orders.courierManifests, { query: { date: day } });
  const manifest = data.manifests.find((m) => m.courier === 'Delhivery');
  assert.equal(manifest.rows[0].codAmount, 350);
  assert.equal(manifest.codTotal, 350);
});

test('Shopify booking sends the partially paid collect amount as cod_amount', async () => {
  const tenant = await newTenant('Book pay shop');
  await Warehouse.create({
    tenantId: tenant._id, code: 'WH-001', name: 'Pickup', type: 'physical', isPickup: true,
    address: { line1: 'Workshop lane', city: 'Jaipur', pincode: '302001' }, contactPhone: '9000000000',
  });
  const doc = await Order.create({
    tenantId: tenant._id, orderNo: 'SHP-PP', channel: 'Shopify', source: 'manual', paymentMode: 'Partially paid', total: 1000,
    city: 'Jaipur 302001', externalOrderId: 'gid-pp', items: [{ name: 'Kurta', sku: 'KURTA', qty: 1, price: 1000 }],
  });
  await Order.collection.updateOne({ _id: doc._id }, { $set: { codAmount: 250 } });
  const created = [];
  const delhiveryRequest = async (method, url, opts = {}) => {
    if (url.includes('pin-codes')) return { status: 200, text: JSON.stringify({ delivery_codes: [{ postal_code: { pre_paid: 'Y', cash: 'Y' } }] }) };
    if (url.includes('/api/cmu/create.json')) {
      created.push(JSON.parse(decodeURIComponent(String(opts.body).replace(/^format=json&data=/, ''))));
      return { status: 200, text: JSON.stringify({ packages: [{ waybill: 'AWB-PP', status: 'Success' }] }) };
    }
    if (url.includes('packing_slip')) return { status: 200, text: '%PDF-1.4 label' };
    throw new Error(`unexpected Delhivery call ${url}`);
  };
  const shopifyRequest = async (method, url) => {
    if (url.includes('fulfillment_orders')) return { status: 200, text: JSON.stringify({ fulfillment_orders: [{ id: 77 }] }) };
    if (url.endsWith('/fulfillments.json')) return { status: 200, text: JSON.stringify({ fulfillment: { id: 88 } }) };
    throw new Error(`unexpected Shopify call ${url}`);
  };
  await bookShopify(tenant._id, 'SHP-PP', {
    delhiveryCreds: { apiToken: 'dlv-test', pickupWarehouse: 'WH-001' },
    delhiveryRequest,
    shopifyCreds: { shopUrl: 'shop.example', adminToken: 'shpat_test', apiMode: 'live' },
    shopifyRequest,
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].shipments[0].payment_mode, 'COD');
  assert.equal(created[0].shipments[0].cod_amount, 250);
  assert.equal(created[0].shipments[0].total_amount, 1000);
});

// ---------- refunds ----------

test('refund cap counts pending refunds of other returns, prices per line, and is enforced on mark refunded', async () => {
  const tenant = await newTenant('Refund shop');
  await Order.create({
    tenantId: tenant._id, orderNo: 'R-1', channel: 'Myntra', source: 'manual', status: 'Delivered', total: 1400,
    items: [{ name: 'K', sku: 'K', qty: 1, price: 1000 }, { name: 'K', sku: 'K', qty: 1, price: 400 }],
  });
  const ret = (returnNo, items, extra = {}) => CustomerReturn.create({ tenantId: tenant._id, returnNo, orderNo: 'R-1', channel: 'Myntra', status: 'Approved', items, ...extra });
  await ret('RET-A', [{ sku: 'K', qty: 2 }]);
  const both = await updateRefund(tenant._id, 'RET-A', { status: 'pending', amount: 1400 });
  assert.equal(both.refundAmount, 1400, 'two K lines are 1000 + 400, not 400 + 400');

  await ret('RET-B', [{ sku: 'K', qty: 1 }]);
  await assert.rejects(updateRefund(tenant._id, 'RET-B', { status: 'pending', amount: 100 }), /₹0/, 'RET-A already holds 1400 pending');

  await ret('RET-C', [{ sku: 'K', qty: 1 }], { refundAmount: 900, refundStatus: 'pending' });
  await assert.rejects(updateRefund(tenant._id, 'RET-C', { status: 'refunded' }), /can't be more/);

  await updateRefund(tenant._id, 'RET-A', { status: 'rejected' });
  const ok = await updateRefund(tenant._id, 'RET-C', { status: 'refunded' });
  assert.equal(ok.refundStatus, 'refunded');
});
