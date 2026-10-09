process.env.NODE_ENV = 'test';
process.env.CHANNEL_ENCRYPTION_KEY = 'phase1-test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const WebhookEvent = require('../src/models/WebhookEvent');
const IntegrationJob = require('../src/models/IntegrationJob');
const { upsertConnection } = require('../src/services/channelConnection.service');
const { processDueJobs } = require('../src/services/jobQueue.service');
const { httpsRequest } = require('../src/adapters/http');
const app = require('../src/app');

let memory;
let server;
let base;

function sign(secret, raw) {
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
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

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  await WebhookEvent.syncIndexes();
  await IntegrationJob.syncIndexes();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('channel HTTP helper rejects plain HTTP', async () => {
  await assert.rejects(() => httpsRequest('http://example.com/orders'), /HTTPS/);
});

test('duplicate webhook stays one row and a forged tenant id is ignored', async () => {
  const stamp = Date.now();
  const a = await Tenant.create({ name: 'Shop A', slug: `shop-a-${stamp}`, kind: 'merchant' });
  const b = await Tenant.create({ name: 'Shop B', slug: `shop-b-${stamp}`, kind: 'merchant' });
  await upsertConnection(a._id, null, 'shopify', {
    credentials: { shopUrl: 'alpha.myshopify.com', webhookSecret: 'secret-a' },
  });
  await upsertConnection(b._id, null, 'shopify', {
    credentials: { shopUrl: 'beta.myshopify.com', webhookSecret: 'secret-b' },
  });

  const raw = JSON.stringify({
    id: 'evt-1',
    topic: 'orders/create',
    tenantId: String(a._id),
  });
  const headers = {
    'x-oms-signature': sign('secret-b', raw),
    'x-oms-event-id': 'evt-1',
    'x-oms-shop': 'beta.myshopify.com',
    'x-oms-topic': 'orders/create',
  };

  const first = await postWebhook('shopify', raw, headers, `?tenantId=${a._id}`);
  assert.equal(first.status, 200);
  assert.equal(first.json.data.duplicate, false);

  const second = await postWebhook('shopify', raw, headers, `?tenantId=${a._id}`);
  assert.equal(second.status, 200);
  assert.equal(second.json.data.duplicate, true);
  assert.equal(second.json.data.status, 'duplicate');

  const events = await WebhookEvent.find({ externalEventId: 'evt-1' });
  assert.equal(events.length, 1);
  assert.equal(String(events[0].tenantId), String(b._id));
  assert.equal(events[0].duplicateCount, 1);
  assert.equal(events[0].payload.tenantId, undefined);

  const jobs = await IntegrationJob.find({ webhookEventId: events[0]._id });
  assert.equal(jobs.length, 1);

  const rejected = await postWebhook('shopify', raw, {
    'x-oms-signature': sign('nope', raw),
    'x-oms-event-id': 'evt-2',
    'x-oms-shop': 'beta.myshopify.com',
  });
  assert.equal(rejected.status, 401);
});

test('a worker crash retries the job and applies the webhook once', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Crash', slug: `crash-${stamp}`, kind: 'merchant' });
  await upsertConnection(tenant._id, null, 'shopify', {
    credentials: { shopUrl: 'crash.myshopify.com', webhookSecret: 'secret-crash' },
  });
  const raw = JSON.stringify({ id: 'evt-crash', topic: 'orders/create' });
  const posted = await postWebhook('shopify', raw, {
    'x-oms-signature': sign('secret-crash', raw),
    'x-oms-event-id': 'evt-crash',
    'x-oms-shop': 'crash.myshopify.com',
    'x-oms-topic': 'orders/create',
  });
  assert.equal(posted.status, 200);
  await IntegrationJob.updateOne(
    { _id: posted.json.data.jobId },
    { $set: { 'payload.simulateCrash': 'after-effect' } },
  );

  await processDueJobs();

  const event = await WebhookEvent.findOne({ externalEventId: 'evt-crash' });
  const job = await IntegrationJob.findById(posted.json.data.jobId);
  assert.equal(event.applyCount, 1);
  assert.equal(event.applied, true);
  assert.equal(event.status, 'processed');
  assert.equal(job.status, 'success');
  assert.equal(job.retriesCount, 1);
});

test('a job left running is requeued on restart and still applies once', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Restart', slug: `restart-${stamp}`, kind: 'merchant' });
  await upsertConnection(tenant._id, null, 'amazon', {
    credentials: { sellerId: 'SELLER1', lwaClientSecret: 'amz-secret' },
  });
  const raw = JSON.stringify({ id: 'evt-restart' });
  const posted = await postWebhook('amazon', raw, {
    'x-oms-signature': sign('amz-secret', raw),
    'x-oms-event-id': 'evt-restart',
    'x-oms-shop': 'SELLER1',
  });
  assert.equal(posted.status, 200);

  await IntegrationJob.updateOne(
    { _id: posted.json.data.jobId },
    { $set: { status: 'running', lockedAt: new Date(0) } },
  );
  await processDueJobs();
  let event = await WebhookEvent.findOne({ externalEventId: 'evt-restart' });
  assert.equal(event.applyCount, 1);
  assert.equal(event.status, 'processed');

  await IntegrationJob.updateOne(
    { _id: posted.json.data.jobId },
    { $set: { status: 'running', lockedAt: new Date(0), effectApplied: true } },
  );
  await processDueJobs();
  event = await WebhookEvent.findOne({ externalEventId: 'evt-restart' });
  const job = await IntegrationJob.findById(posted.json.data.jobId);
  assert.equal(event.applyCount, 1);
  assert.equal(job.status, 'success');
});

test('orders_pull without a live connection is failed, not success', async () => {
  const stamp = Date.now();
  const tenant = await Tenant.create({ name: 'Pull', slug: `pull-${stamp}`, kind: 'merchant' });
  const job = await IntegrationJob.create({
    tenantId: tenant._id,
    channel: 'shopify',
    jobType: 'orders_pull',
    direction: 'pull',
    status: 'queued',
    triggeredBy: 'manual',
    nextRunAt: new Date(),
  });
  await processDueJobs();
  const fresh = await IntegrationJob.findById(job._id);
  assert.equal(fresh.status, 'failed');
  assert.equal(fresh.effectApplied, false);
  assert.equal(fresh.retriesCount, 0);
  assert.match(fresh.lastError, /Shopify orders were not pulled/);
  assert.equal(fresh.shortSummary, fresh.lastError);
});
