process.env.NODE_ENV = 'test';
process.env.CHANNEL_ENCRYPTION_KEY = 'channel-sync-test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const https = require('https');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Tenant = require('../src/models/Tenant');
const MasterSku = require('../src/models/MasterSku');
const Warehouse = require('../src/models/Warehouse');
const SkuMapping = require('../src/models/SkuMapping');
const Order = require('../src/models/Order');
const WebhookEvent = require('../src/models/WebhookEvent');
const IntegrationJob = require('../src/models/IntegrationJob');
const InventoryReservation = require('../src/models/InventoryReservation');
const shopify = require('../src/adapters/shopify');
const { probeConnection } = require('../src/adapters/amazon');
const { upsertConnection, credsOf, recordTest } = require('../src/services/channelConnection.service');
const { processDueJobs } = require('../src/services/jobQueue.service');
const { pullReady } = require('../src/services/channelScheduler.service');
const { stockIn } = require('../src/services/inventory.service');
const app = require('../src/app');

let replSet;
let server;
let base;
let tail = Promise.resolve();

function locked(fn) {
  const run = tail.then(fn, fn);
  tail = run.then(() => {}, () => {});
  return run;
}

function sign(secret, raw) {
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

function blockSockets() {
  const original = https.request;
  let calls = 0;
  https.request = function blockedRequest() {
    calls += 1;
    const req = new (require('events').EventEmitter)();
    req.write = () => req;
    req.destroy = () => req;
    req.setTimeout = () => req;
    req.abort = () => req;
    req.end = () => {
      process.nextTick(() => req.emit('error', new Error('socket blocked by test')));
      return req;
    };
    return req;
  };
  return {
    calls: () => calls,
    restore() { https.request = original; },
  };
}

function shopifyBody(id, extra = {}) {
  return {
    id,
    financial_status: 'paid',
    payment_gateway_names: ['UPI'],
    total_price: '100.00',
    created_at: '2026-08-01T10:00:00Z',
    line_items: [{ id, sku: 'KURTA', title: 'Kurta', quantity: 1, price: '100.00' }],
    ...extra,
  };
}

async function postWebhook(channel, raw, headers, query = '') {
  const res = await fetch(`${base}/api/v1/integrations/${channel}/webhook${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw,
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function seller(name) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tenant = await Tenant.create({ name, slug: `${name}-${stamp}`.toLowerCase().replace(/[^a-z0-9-]/g, ''), kind: 'merchant' });
  const sku = await MasterSku.create({ tenantId: tenant._id, code: `KURTA-${stamp}`, name: 'Kurta' });
  const physical = await Warehouse.create({
    tenantId: tenant._id,
    code: 'WH-001',
    name: 'Physical',
    type: 'physical',
    isDefault: true,
    isPickup: true,
    sellOnShopify: true,
    status: 'active',
  });
  await SkuMapping.create({
    tenantId: tenant._id,
    masterSkuId: sku._id,
    channel: 'shopify',
    channelVariantId: `var-${stamp}`,
    channelSkuCode: 'KURTA',
    channelSkuCodeNorm: 'kurta',
    syncStatus: 'synced',
  });
  await stockIn(String(tenant._id), null, {
    masterSkuId: sku._id,
    warehouseId: physical._id,
    qty: 5,
    reason: 'opening',
  });
  return tenant;
}

async function pullJob(tenantId, channel) {
  return IntegrationJob.create({
    tenantId,
    channel,
    jobType: 'orders_pull',
    direction: 'pull',
    status: 'queued',
    triggeredBy: 'manual',
    nextRunAt: new Date(),
  });
}

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Promise.all([
    Order.syncIndexes(),
    WebhookEvent.syncIndexes(),
    IntegrationJob.syncIndexes(),
    InventoryReservation.syncIndexes(),
  ]);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

test('empty or blank channel keys fail the order pull and do not open a socket', async () => locked(async () => {
  const gate = blockSockets();
  try {
    assert.equal(pullReady({ status: 'saved', channel: 'shopify' }, { shopUrl: ' ', adminToken: ' ' }), false);
    assert.equal(pullReady({ status: 'saved', channel: 'amazon' }, {
      sellerId: ' ', refreshToken: ' ', lwaClientId: ' ', lwaClientSecret: ' ',
    }), false);
    assert.equal(pullReady({ status: 'saved', channel: 'myntra' }, { merchantId: ' ', secretKey: ' ' }), false);
    assert.equal(pullReady({ status: 'saved', channel: 'amazon' }, {}), false);

    const blanks = [
      ['shopify', { shopUrl: ' ', adminToken: ' ', apiMode: 'sandbox' }],
      ['amazon', { sellerId: ' ', refreshToken: ' ', lwaClientId: ' ', lwaClientSecret: ' ', apiMode: 'sandbox' }],
      ['myntra', { merchantId: ' ', secretKey: ' ', apiMode: 'sandbox' }],
    ];
    for (const [channel, credentials] of blanks) {
      const tenant = await Tenant.create({
        name: channel,
        slug: `blank-${channel}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kind: 'merchant',
      });
      await upsertConnection(tenant._id, null, channel, { credentials });
      const job = await pullJob(tenant._id, channel);
      await processDueJobs();
      const fresh = await IntegrationJob.findById(job._id);
      assert.equal(fresh.status, 'failed', channel);
      assert.equal(fresh.retriesCount, 0, channel);
      assert.match(fresh.lastError, /were not pulled/);
      assert.equal(await Order.countDocuments({ tenantId: tenant._id }), 0);
    }
    assert.equal(gate.calls(), 0);
  } finally {
    gate.restore();
  }
}));

test('the same Shopify webhook twice creates one order and one reserve', async () => locked(async () => {
  const tenant = await seller('Webhook');
  await upsertConnection(tenant._id, null, 'shopify', {
    credentials: { shopUrl: 'hook.myshopify.com', webhookSecret: 'hook-secret', apiMode: 'sandbox' },
  });
  const raw = JSON.stringify(shopifyBody(9001));
  const headers = {
    'x-oms-signature': sign('hook-secret', raw),
    'x-oms-event-id': 'evt-9001',
    'x-oms-shop': 'hook.myshopify.com',
    'x-oms-topic': 'orders/create',
  };
  const first = await postWebhook('shopify', raw, headers);
  const second = await postWebhook('shopify', raw, headers);
  assert.equal(first.status, 200);
  assert.equal(first.json.data.duplicate, false);
  assert.equal(second.json.data.duplicate, true);
  await processDueJobs();

  const orders = await Order.find({ tenantId: tenant._id, externalOrderId: '9001' });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].orderNo, 'SHP-9001');
  const reserves = await InventoryReservation.countDocuments({
    tenantId: tenant._id,
    orderRef: 'SHP-9001',
    status: 'held',
  });
  assert.equal(reserves, 1);
  const events = await WebhookEvent.find({ externalEventId: 'evt-9001' });
  assert.equal(events.length, 1);
  assert.equal(await IntegrationJob.countDocuments({ webhookEventId: events[0]._id }), 1);
}));

test('a tenant id in the webhook URL cannot create an order in that company', async () => locked(async () => {
  const victim = await seller('Victim');
  const owner = await seller('Owner');
  await upsertConnection(victim._id, null, 'shopify', {
    credentials: { shopUrl: 'victim.myshopify.com', webhookSecret: 'victim-secret', apiMode: 'sandbox' },
  });
  await upsertConnection(owner._id, null, 'shopify', {
    credentials: { shopUrl: 'owner.myshopify.com', webhookSecret: 'owner-secret', apiMode: 'sandbox' },
  });
  const raw = JSON.stringify(shopifyBody(9002, { tenantId: String(victim._id), companyId: String(victim._id) }));
  const posted = await postWebhook('shopify', raw, {
    'x-oms-signature': sign('owner-secret', raw),
    'x-oms-event-id': 'evt-9002',
    'x-oms-shop': 'owner.myshopify.com',
    'x-oms-topic': 'orders/create',
    'x-oms-tenant': String(victim._id),
  }, `?tenantId=${victim._id}&companyId=${victim._id}`);
  assert.equal(posted.status, 200);
  await processDueJobs();

  assert.equal(await Order.countDocuments({ tenantId: victim._id }), 0);
  const orders = await Order.find({ tenantId: owner._id, externalOrderId: '9002' });
  assert.equal(orders.length, 1);
  const event = await WebhookEvent.findOne({ externalEventId: 'evt-9002' });
  assert.equal(String(event.tenantId), String(owner._id));
  assert.equal(event.payload.tenantId, undefined);
}));

test('an order pull interrupted midway resumes without creating an order twice', async () => locked(async () => {
  const tenant = await seller('Resume');
  await upsertConnection(tenant._id, null, 'shopify', {
    credentials: { shopUrl: 'resume.myshopify.com', adminToken: 'shpat_test', apiMode: 'sandbox' },
  });
  const original = shopify.pullOrders;
  shopify.pullOrders = async () => [
    shopify.mapShopifyOrder(shopifyBody(1), {}),
    shopify.mapShopifyOrder(shopifyBody(2), {}),
  ];
  try {
    const job = await pullJob(tenant._id, 'shopify');
    job.payload = { interruptAfter: 1 };
    await job.save();
    await processDueJobs();

    const midway = await IntegrationJob.findById(job._id);
    assert.notEqual(midway.status, 'success');
    assert.equal(await Order.countDocuments({ tenantId: tenant._id, externalOrderId: '1' }), 1);
    assert.equal(await Order.countDocuments({ tenantId: tenant._id, externalOrderId: '2' }), 0);
    assert.equal(await InventoryReservation.countDocuments({ tenantId: tenant._id, orderRef: 'SHP-1', status: 'held' }), 1);

    await IntegrationJob.updateOne(
      { _id: job._id },
      { $set: { status: 'running', lockedAt: new Date(0), nextRunAt: new Date() } },
    );
    await processDueJobs();

    const done = await IntegrationJob.findById(job._id);
    assert.equal(done.status, 'success');
    assert.equal(await Order.countDocuments({ tenantId: tenant._id, externalOrderId: '1' }), 1);
    assert.equal(await Order.countDocuments({ tenantId: tenant._id, externalOrderId: '2' }), 1);
    assert.equal(await InventoryReservation.countDocuments({ tenantId: tenant._id, orderRef: 'SHP-1', status: 'held' }), 1);
    assert.equal(await InventoryReservation.countDocuments({ tenantId: tenant._id, orderRef: 'SHP-2', status: 'held' }), 1);
  } finally {
    shopify.pullOrders = original;
  }
}));

test('saving Amazon as live clears sandbox connected and live stays disconnected without real keys', async () => {
  const gate = blockSockets();
  try {
    const tenant = await Tenant.create({
      name: 'Amazon',
      slug: `amazon-${Date.now()}`,
      kind: 'merchant',
    });
    const refresh = `Atzr|${'a'.repeat(48)}`;
    const realLooking = {
      sellerId: 'A1F9SELLER1',
      refreshToken: refresh,
      lwaClientId: 'amzn1.application-oa2-client.exampleclientid123456',
      lwaClientSecret: 's'.repeat(48),
    };
    const sandbox = await upsertConnection(tenant._id, null, 'amazon', {
      credentials: { ...realLooking, apiMode: 'sandbox' },
    });
    await recordTest(sandbox, { ok: true, message: 'Amazon sandbox refresh token exchanged and the sandbox orders call returned.' });
    const connected = await mongoose.model('ChannelConnection').findById(sandbox._id);
    assert.equal(connected.status, 'connected');
    assert.equal(connected.lastTestOk, true);

    const saved = await upsertConnection(tenant._id, null, 'amazon', {
      credentials: { apiMode: 'live' },
    });
    assert.equal(saved.status, 'saved');
    assert.equal(saved.lastTestOk, false);
    assert.match(saved.lastTestMessage, /Live is not connected/);
    assert.equal(credsOf(saved).apiMode, 'live');
    assert.equal(credsOf(saved).refreshToken, refresh);

    await recordTest(saved, { ok: true, message: 'Amazon live orders API accepted the seller credentials.' });
    const refused = await mongoose.model('ChannelConnection').findById(saved._id);
    assert.notEqual(refused.status, 'connected');
    assert.equal(refused.lastTestOk, false);
    assert.match(refused.lastTestMessage, /Live is not connected/);

    const placeholders = await upsertConnection(tenant._id, null, 'amazon', {
      credentials: {
        apiMode: 'live',
        sellerId: 'SELLER',
        refreshToken: 'r',
        lwaClientId: 'c',
        lwaClientSecret: 's',
      },
    });
    await recordTest(placeholders, { ok: true, message: 'should not stick' });
    const marked = await mongoose.model('ChannelConnection').findById(placeholders._id);
    assert.notEqual(marked.status, 'connected');
    assert.equal(marked.lastTestOk, false);

    await assert.rejects(
      () => probeConnection(credsOf(marked)),
      /Live is not connected|was not called|production/,
    );
    assert.equal(gate.calls(), 0);
  } finally {
    gate.restore();
  }
});
