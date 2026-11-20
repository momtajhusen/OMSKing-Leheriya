process.env.NODE_ENV = 'test';
process.env.REQUIRE_LOGIN_OTP = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const Order = require('../src/models/Order');
const AuditLog = require('../src/models/AuditLog');

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
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function merchant(label = 'rev') {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const ownerEmail = `${label}-${stamp}@example.com`;
  const created = await provisionMerchant({
    name: `Reverse ${stamp}`, ownerEmail, ownerName: 'Owner', password: PASSWORD, status: 'active',
  });
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
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('book reverse stores courier AWB, and cancel removes it', async () => {
  const { tenantId, token } = await merchant();
  await Order.create({
    tenantId,
    orderNo: 'SHP-19098769686621',
    channelOrderNo: '#70090-LEH',
    externalOrderId: '19098769686621',
    channel: 'Shopify',
    status: 'Delivered',
    customer: 'Cessna Mehta',
    address: 'Delhi',
    city: 'Delhi',
    total: 5999,
    courier: 'Delhivery',
    items: [{ name: 'Bridal', sku: 'LEHBRIDAL21', qty: 1, price: 5999 }],
  });

  const missingAwb = await api('POST', '/api/v1/orders/SHP-19098769686621/reverse', {
    token,
    json: { reason: 'Customer reverse pickup', courier: 'Xpressbees' },
  });
  assert.equal(missingAwb.status, 400);
  assert.match(String(missingAwb.body?.message || ''), /paste the AWB|not booked by OMS API/i);

  const booked = await api('POST', '/api/v1/orders/SHP-19098769686621/reverse', {
    token,
    json: { reason: 'Customer reverse pickup', courier: 'Xpressbees', awb: 'REV-TRACK-1' },
  });
  assert.equal(booked.status, 200, JSON.stringify(booked.body));
  assert.equal(booked.body.data.reversePickup.returnId, 'RET-70090-LEH');
  assert.equal(booked.body.data.reversePickup.awb, 'REV-TRACK-1');
  assert.equal(booked.body.data.reversePickup.courier, 'Xpressbees');
  assert.ok(booked.body.data.reverseLabelHtml);

  const patched = await api('PATCH', '/api/v1/orders/SHP-19098769686621/reverse', {
    token,
    json: { courier: 'Xpressbees', awb: 'REV-TRACK-2' },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.data.reversePickup.awb, 'REV-TRACK-2');

  const cancelled = await api('DELETE', '/api/v1/orders/SHP-19098769686621/reverse', { token });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.reversePickup, null);

  const saved = await Order.findOne({ tenantId, orderNo: 'SHP-19098769686621' }).lean();
  assert.equal(saved.reversePickup?.returnId || '', '');

  const audit = await AuditLog.findOne({ tenantId, action: 'order.reverse_cancelled' }).lean();
  assert.ok(audit);
  assert.equal(audit.before.returnId, 'RET-70090-LEH');
});

test('Delhivery reverse books AWB via API when reverse AWB is blank', async () => {
  const { bookReversePickup } = require('../src/services/ship.service');
  const Warehouse = require('../src/models/Warehouse');
  const CustomerReturn = require('../src/models/CustomerReturn');
  const { tenantId } = await merchant('dlv-rev');
  await Warehouse.updateOne(
    { tenantId, code: 'WH-001' },
    {
      $set: {
        name: 'Pickup',
        type: 'physical',
        isPickup: true,
        status: 'active',
        address: { line1: 'Workshop lane', city: 'Jaipur', state: 'Rajasthan', pincode: '302001' },
        contactPhone: '9000000000',
      },
    },
    { upsert: true },
  );
  const order = await Order.create({
    tenantId,
    orderNo: 'SHP-REV-DLV-API',
    channelOrderNo: '70091-LEH',
    externalOrderId: '19100000000001',
    channel: 'Shopify',
    status: 'Delivered',
    customer: 'Kavita Singh',
    address: 'Sector 62',
    city: 'Noida 201301',
    phone: '9873384751',
    total: 1999,
    items: [{ name: 'Saree', sku: 'SAR1', qty: 1, price: 1999 }],
  });

  let createBody = '';
  const booked = await bookReversePickup(tenantId, order, {
    courier: 'Delhivery',
    reason: 'Customer reverse pickup',
    deps: {
      delhiveryCreds: { apiToken: 'dlv-test', pickupWarehouse: 'WH-001', clientName: 'Leheriya' },
      delhiveryRequest: async (_method, url, opts = {}) => {
        if (String(url).includes('pin-codes')) {
          return {
            status: 200,
            text: JSON.stringify({ delivery_codes: [{ postal_code: { cash: 'Y', pre_paid: 'Y' } }] }),
          };
        }
        if (String(url).includes('create.json')) {
          createBody = String(opts.body || '');
          return {
            status: 200,
            text: JSON.stringify({ packages: [{ waybill: 'RVP123456789', status: 'Success', payment: 'Pickup' }] }),
          };
        }
        throw new Error(`unexpected Delhivery call ${url}`);
      },
    },
  });

  assert.equal(booked.awb, 'RVP123456789');
  assert.equal(booked.courier, 'Delhivery');
  assert.equal(booked.bookedViaApi, true);
  assert.equal(booked.returnId, 'RET-70091-LEH');
  const decoded = decodeURIComponent(createBody);
  assert.match(decoded, /"payment_mode":"Pickup"/);
  assert.match(decoded, /"order":"RET-70091-LEH"/);
  assert.doesNotMatch(decoded, /SHP-REV-DLV-API/);
  assert.match(decoded, /"return_add"/);
  assert.match(decoded, /Workshop lane/);
  assert.match(decoded, /201301/);

  const ret = await CustomerReturn.findOne({ tenantId, returnNo: booked.returnId }).lean();
  assert.ok(ret);
  assert.equal(ret.labelAwb, 'RVP123456789');
  assert.equal(ret.orderNo, 'SHP-REV-DLV-API');
});

test('Bluedart reverse books AWB via API when reverse AWB is blank', async () => {
  const { bookReversePickup } = require('../src/services/ship.service');
  const Warehouse = require('../src/models/Warehouse');
  const CustomerReturn = require('../src/models/CustomerReturn');
  const { tenantId } = await merchant('bd-rev');
  await Warehouse.updateOne(
    { tenantId, code: 'WH-001' },
    {
      $set: {
        name: 'Pickup',
        type: 'physical',
        isPickup: true,
        status: 'active',
        address: { line1: 'Workshop lane', city: 'Jaipur', state: 'Rajasthan', pincode: '302002' },
        contactPhone: '9000000000',
      },
    },
    { upsert: true },
  );
  const order = await Order.create({
    tenantId,
    orderNo: 'SHP-REV-BD-API',
    channel: 'Shopify',
    status: 'Delivered',
    customer: 'Kavita Singh',
    address: 'Sector 62',
    city: 'Noida 201301',
    phone: '9873384751',
    total: 1999,
    items: [{
      name: 'Saree', sku: 'SAR1', qty: 1, price: 1999,
      pack: { weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 4 },
    }],
  });

  let waybillBody = null;
  const booked = await bookReversePickup(tenantId, order, {
    courier: 'Bluedart',
    reason: 'Customer reverse pickup',
    deps: {
      bluedartCreds: {
        apiMode: 'sandbox',
        clientId: 'bd-client',
        clientSecret: 'bd-secret',
        loginId: 'DEL79448',
        licenceKey: 'licence',
        customerCode: '871102',
      },
      bluedartRequest: async (method, url, opts = {}) => {
        if (String(url).includes('/token/')) {
          return { status: 200, text: JSON.stringify({ JWTToken: 'jwt-rev' }) };
        }
        if (String(url).includes('GenerateWayBill')) {
          waybillBody = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
          return {
            status: 200,
            text: JSON.stringify({
              GenerateWayBillResult: {
                IsError: false,
                AWBNo: 'BDREV998877',
                AWBPrintContent: Buffer.from('%PDF-1.4 reverse').toString('base64'),
              },
            }),
          };
        }
        throw new Error(`unexpected Blue Dart call ${url}`);
      },
    },
  });

  assert.equal(booked.awb, 'BDREV998877');
  assert.equal(booked.courier, 'Bluedart');
  assert.equal(booked.bookedViaApi, true);
  assert.equal(waybillBody.Request.Services.IsReversePickup, true);
  assert.equal(waybillBody.Request.Services.SubProductCode, 'P');
  assert.equal(waybillBody.Request.Consignee.ConsigneePincode, '201301');
  assert.equal(waybillBody.Request.Returnadds.ReturnPincode, '302002');
  assert.equal(waybillBody.Request.Shipper.VendorCode, undefined);

  const ret = await CustomerReturn.findOne({ tenantId, returnNo: booked.returnId }).lean();
  assert.ok(ret);
  assert.equal(ret.labelAwb, 'BDREV998877');
});

test('cancel reverse fails when none is booked', async () => {
  const { tenantId, token } = await merchant('norev');
  await Order.create({
    tenantId,
    orderNo: 'SHP-NO-REV',
    channel: 'Shopify',
    status: 'Delivered',
    customer: 'A',
    total: 100,
    items: [{ name: 'X', sku: 'X1', qty: 1, price: 100 }],
  });
  const res = await api('DELETE', '/api/v1/orders/SHP-NO-REV/reverse', { token });
  assert.equal(res.status, 400);
});
