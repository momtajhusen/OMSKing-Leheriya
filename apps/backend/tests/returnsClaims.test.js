process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const CustomerReturn = require('../src/models/CustomerReturn');
const flow = require('../src/services/returnsFlow.service');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

async function seller() {
  const n = new mongoose.Types.ObjectId().toString().slice(-6);
  return Tenant.create({ name: `Returns ${n}`, slug: `returns-${n}-${Date.now()}`, kind: 'merchant' });
}

async function approvedReturn(tenantId, channel, returnNo) {
  const orderNo = `${channel.slice(0, 3).toUpperCase()}-${returnNo}`;
  await Order.create({ tenantId, orderNo, channel, items: [{ sku: 'SKU-1', qty: 1, price: 999 }] });
  return CustomerReturn.create({ tenantId, returnNo, orderNo, channel, status: 'Approved', items: [{ sku: 'SKU-1', qty: 1 }] });
}

test('returns are split into customer returns and RTO; the list says which one each is', async () => {
  const tenant = await seller();
  await Order.create({ tenantId: tenant._id, orderNo: 'MYN-1', channel: 'Myntra', externalOrderId: '1', items: [{ sku: 'A', qty: 1 }] });
  await Order.create({ tenantId: tenant._id, orderNo: 'MYN-2', channel: 'Myntra', externalOrderId: '2', items: [{ sku: 'B', qty: 1 }] });
  await flow.ingestReturns(tenant._id, [
    { returnNo: 'MYN-RET-1', orderNo: 'MYN-1', channel: 'Myntra', reason: 'Size issue' },
    { returnNo: 'MYN-RET-2', orderNo: 'MYN-2', channel: 'Myntra', reason: 'RTO - customer not available', kind: 'rto' },
  ]);
  const rows = await flow.listReturns(tenant._id);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId['MYN-RET-1'].kind, 'customer');
  assert.equal(byId['MYN-RET-2'].kind, 'rto');
  assert.equal(byId['MYN-RET-1'].qcStatus, 'pending');
  assert.equal(byId['MYN-RET-1'].refundStatus, 'pending');
  assert.deepEqual(byId['MYN-RET-1'].claim, { type: 'myntra', status: 'none', claimId: '', amount: 0, note: '' });
});

test('QC fail on an Amazon return opens a SAFE-T claim to file, Myntra opens a Myntra claim, Shopify none; nothing is restocked', async () => {
  const tenant = await seller();
  await approvedReturn(tenant._id, 'Amazon', 'AMZ-RET-9');
  await approvedReturn(tenant._id, 'Myntra', 'MYN-RET-9');
  await approvedReturn(tenant._id, 'Shopify', 'SHP-RET-9');

  const amz = await flow.receiveReturn(tenant._id, null, 'AMZ-RET-9', { action: 'damaged', qcNote: 'Torn fabric' });
  assert.equal(amz.restock, null);
  assert.equal(amz.row.qcStatus, 'fail');
  assert.equal(amz.row.qcNote, 'Torn fabric');
  assert.equal(amz.row.claim.type, 'safet');
  assert.equal(amz.row.claim.status, 'to_file');

  const myn = await flow.receiveReturn(tenant._id, null, 'MYN-RET-9', { action: 'damaged' });
  assert.equal(myn.row.claim.type, 'myntra');
  assert.equal(myn.row.claim.status, 'to_file');

  const shp = await flow.receiveReturn(tenant._id, null, 'SHP-RET-9', { action: 'damaged' });
  assert.equal(shp.row.claim.status, 'none', 'Shopify has no marketplace claim');

  const hold = await approvedReturn(tenant._id, 'Amazon', 'AMZ-RET-10');
  const held = await flow.receiveReturn(tenant._id, null, hold.returnNo, { action: 'hold' });
  assert.equal(held.row.qcStatus, 'hold');
  assert.equal(held.row.claim.status, 'none');
});

test('claim moves To file → Filed (needs the claim ID) → Approved (amount) or Rejected; refund status is saved', async () => {
  const tenant = await seller();
  await approvedReturn(tenant._id, 'Amazon', 'AMZ-RET-20');
  await flow.receiveReturn(tenant._id, null, 'AMZ-RET-20', { action: 'damaged' });

  await assert.rejects(() => flow.updateClaim(tenant._id, 'AMZ-RET-20', { status: 'filed' }), /SAFE-T claim ID/);
  const filed = await flow.updateClaim(tenant._id, 'AMZ-RET-20', { status: 'filed', claimId: ' 1234567890 ' });
  assert.equal(filed.claim.status, 'filed');
  assert.equal(filed.claim.claimId, '1234567890');
  assert.ok(filed.claim.filedAt);
  const approved = await flow.updateClaim(tenant._id, 'AMZ-RET-20', { status: 'approved', amount: 650 });
  assert.equal(approved.claim.status, 'approved');
  assert.equal(approved.claim.amount, 650);
  assert.ok(approved.claim.settledAt);
  await assert.rejects(() => flow.updateClaim(tenant._id, 'AMZ-RET-20', { status: 'maybe' }), /Unknown claim status/);

  await approvedReturn(tenant._id, 'Shopify', 'SHP-RET-20');
  await assert.rejects(() => flow.updateClaim(tenant._id, 'SHP-RET-20', { status: 'to_file' }), /only for Amazon \(SAFE-T\) and Myntra/);

  const refunded = await flow.updateRefund(tenant._id, 'AMZ-RET-20', { status: 'refunded', amount: 999 });
  assert.equal(refunded.refundStatus, 'refunded');
  assert.equal(refunded.refundAmount, 999);
  await assert.rejects(() => flow.updateRefund(tenant._id, 'AMZ-RET-20', { status: 'later' }), /Unknown refund status/);
});

test('another company cannot change this company\'s claim or refund', async () => {
  const owner = await seller();
  const other = await seller();
  await approvedReturn(owner._id, 'Amazon', 'AMZ-RET-30');
  await assert.rejects(() => flow.updateClaim(other._id, 'AMZ-RET-30', { status: 'to_file' }), (err) => err.statusCode === 404);
  await assert.rejects(() => flow.updateRefund(other._id, 'AMZ-RET-30', { status: 'refunded' }), (err) => err.statusCode === 404);
});
