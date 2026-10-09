const IntegrationJob = require('../models/IntegrationJob');
const WebhookEvent = require('../models/WebhookEvent');
const { HttpError } = require('../utils/httpError');
const { getConnection, credsOf } = require('./channelConnection.service');
const { bullEnabled, scheduleBull, startBullTransport, stopBullTransport } = require('./bullTransport');

const { channelIds, channelById } = require('../channels/registry');
const { adapterFor } = require('../adapters');
const partner = require('../adapters/partner');

const CHANNELS = new Set(channelIds());
const MANUAL_TYPES = new Set(['orders_pull', 'inventory_push', 'products_pull']);
const STUCK_MS = 15_000;
const MAX_RETRIES = 5;

let timer = null;

function retryDelayMs(count) {
  if (process.env.NODE_ENV === 'test') return 0;
  return Math.min(60_000, 500 * (2 ** Math.max(0, count - 1)));
}

function directionFor(jobType) {
  return jobType === 'inventory_push' || jobType === 'shipment_push' ? 'push' : 'pull';
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/\b(?:shpat|shpca|shpse|xoxb|xoxp|ya29)_[A-Za-z0-9_\-]+/g, '[redacted]')
    .replace(/(token|secret|password|apiToken|webhookSecret|accessToken)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

function toJobDto(row) {
  return {
    id: String(row._id),
    channel: row.channel,
    jobType: row.jobType,
    direction: row.direction,
    status: row.status,
    retriesCount: row.retriesCount || 0,
    triggeredBy: row.triggeredBy,
    shortSummary: redactSecrets(row.shortSummary),
    lastError: redactSecrets(row.lastError),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    webhookEventId: row.webhookEventId ? String(row.webhookEventId) : null,
    effectApplied: Boolean(row.effectApplied),
    recordsTotal: row.recordsTotal || 0,
    recordsProcessed: row.recordsProcessed || 0,
    recordsFailed: row.recordsFailed || 0,
  };
}

async function enqueue({
  tenantId,
  channel,
  jobType,
  triggeredBy,
  triggeredByUserId,
  webhookEventId,
  payload,
}) {
  const job = await IntegrationJob.create({
    tenantId,
    channel,
    jobType,
    direction: directionFor(jobType),
    status: 'queued',
    triggeredBy: triggeredBy || 'manual',
    triggeredByUserId: triggeredByUserId || null,
    webhookEventId: webhookEventId || null,
    payload: payload || {},
    nextRunAt: new Date(),
    retriesCount: 0,
    maxRetries: MAX_RETRIES,
  });
  await scheduleBull(job, 0);
  return job;
}

async function enqueueManual(tenantId, userId, body) {
  const channel = String(body?.channel || '').toLowerCase();
  const jobType = String(body?.jobType || 'orders_pull');
  if (!CHANNELS.has(channel)) throw new HttpError(400, 'Unknown channel');
  if (!MANUAL_TYPES.has(jobType)) throw new HttpError(400, 'Job type must be orders_pull, products_pull, or inventory_push');
  if (jobType === 'orders_pull' && !(await hasLiveConnection(tenantId, channel))) {
    throw new HttpError(400, notLiveMessage(channel, jobType));
  }
  if (jobType === 'products_pull') {
    const { catalogPullBlock } = require('./catalogPull.service');
    const blocked = await catalogPullBlock(tenantId, channel);
    if (blocked) throw new HttpError(400, blocked);
  }
  if (jobType === 'inventory_push' && body?.masterSkuId) {
    const job = await enqueue({
      tenantId,
      channel,
      jobType,
      triggeredBy: 'manual',
      triggeredByUserId: userId,
      payload: { masterSkuId: String(body.masterSkuId) },
    });
    return toJobDto(job);
  }
  const job = await enqueue({
    tenantId,
    channel,
    jobType,
    triggeredBy: 'manual',
    triggeredByUserId: userId,
  });
  return toJobDto(job);
}

async function listJobs(tenantId) {
  const rows = await IntegrationJob.find({ tenantId })
    .sort({ createdAt: -1 })
    .limit(100)
    .setOptions({ skipTenantFilter: true });
  return rows.map(toJobDto);
}

async function listPlatformJobs({ failedOnly = false, limit = 100 } = {}) {
  const Tenant = require('../models/Tenant');
  const filter = failedOnly ? { status: 'failed' } : {};
  const rows = await IntegrationJob.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .setOptions({ skipTenantFilter: true });
  const ids = [...new Set(rows.map((row) => String(row.tenantId)))];
  const tenants = await Tenant.find({ _id: { $in: ids } }).select('name').setOptions({ skipTenantFilter: true });
  const names = new Map(tenants.map((tenant) => [String(tenant._id), tenant.name]));
  return rows.map((row) => ({
    ...toJobDto(row),
    tenantId: String(row.tenantId),
    tenantName: names.get(String(row.tenantId)) || '',
  }));
}

async function requeueJob(tenantId, userId, id) {
  const job = await IntegrationJob.findOne({ _id: id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!job) throw new HttpError(404, 'Job not found');
  if (job.status !== 'failed') throw new HttpError(409, 'Only a failed job can be retried');
  job.status = 'queued';
  job.nextRunAt = new Date();
  job.lastError = '';
  job.lockedAt = null;
  job.triggeredBy = 'manual';
  job.triggeredByUserId = userId || null;
  await job.save();
  await scheduleBull(job, 0);
  return toJobDto(job);
}

async function noteCrash(job) {
  if (job.payload?.simulateCrash !== 'after-effect') return;
  await IntegrationJob.updateOne(
    { _id: job._id, 'payload.simulateCrash': 'after-effect' },
    { $set: { 'payload.simulateCrash': 'done' } },
  ).setOptions({ skipTenantFilter: true });
  const err = new Error('Worker stopped after the side effect');
  err.crash = true;
  throw err;
}

async function applyOnce(job, summary) {
  await IntegrationJob.findOneAndUpdate(
    { _id: job._id, effectApplied: { $ne: true } },
    {
      $set: { effectApplied: true, shortSummary: summary },
      $inc: { effectCount: 1 },
    },
    { new: true },
  ).setOptions({ skipTenantFilter: true });
  await noteCrash(job);
}

async function handleWebhook(job) {
  const claimed = await WebhookEvent.findOneAndUpdate(
    { _id: job.webhookEventId, applied: { $ne: true } },
    { $set: { applied: true }, $inc: { applyCount: 1 } },
    { new: true },
  ).setOptions({ skipTenantFilter: true });
  if (claimed) {
    const { applyStoredWebhook } = require('./channelOrder.service');
    await applyStoredWebhook(claimed);
  }
  await noteCrash(job);
  await WebhookEvent.updateOne(
    { _id: job.webhookEventId },
    { $set: { status: 'processed', processedAt: new Date(), lastError: '' } },
  ).setOptions({ skipTenantFilter: true });
  job.shortSummary = 'Webhook applied once';
}

function notLiveMessage(channel, jobType) {
  if (jobType === 'inventory_push') {
    return `${channel} stock was not pushed. No inventory API was called.`;
  }
  if (channel === 'shopify') {
    return 'Shopify orders were not pulled. Shop URL and Admin API token are missing, so the Shopify orders API was not called.';
  }
  if (channel === 'amazon') {
    return 'Amazon orders were not pulled. Seller ID, refresh token, and LWA client id + secret are required before the orders API is called.';
  }
  if (channel === 'myntra') {
    return 'Myntra orders were not pulled. Merchant Id and Secret Key are required before the Myntra API is called.';
  }
  const meta = channelById(channel);
  if (meta?.kind === 'partner') {
    return `${meta.name} orders were not pulled. API host and token are required before the orders API is called.`;
  }
  return `${channel} ${jobType} did not run. No live API is connected.`;
}

function terminalError(message) {
  const err = new Error(message);
  err.terminal = true;
  return err;
}

async function hasLiveConnection(tenantId, channel) {
  const row = await getConnection(tenantId, channel);
  if (!row) return false;
  const creds = credsOf(row);
  if (channel === 'shopify') return Boolean(String(creds.shopUrl || '').trim() && String(creds.adminToken || '').trim());
  if (channel === 'myntra') return Boolean(creds.merchantId && creds.secretKey);
  if (channel === 'amazon') {
    return Boolean(creds.sellerId && creds.refreshToken && creds.lwaClientId && creds.lwaClientSecret);
  }
  if (channelById(channel)?.kind === 'partner') return Boolean(partner.baseOf(creds) && partner.tokenOf(creds));
  return false;
}

async function pullLiveOrders(job) {
  if (job.channel === 'shopify') {
    const shopify = require('../adapters/shopify');
    const { ingestChannelOrders } = require('./channelOrder.service');
    const creds = credsOf(await getConnection(job.tenantId, 'shopify'));
    const orders = await shopify.pullOrders(creds);
    const res = await ingestChannelOrders(job.tenantId, 'shopify', orders);
    const summary = `Shopify ${res.fetched} orders: ${res.created} new, ${res.updated} updated, ${res.unchanged} unchanged.`;
    await IntegrationJob.updateOne(
      { _id: job._id },
      { $set: { shortSummary: summary, recordsTotal: res.fetched, recordsProcessed: res.created + res.updated + res.unchanged } },
    ).setOptions({ skipTenantFilter: true });
    return;
  }
  if (job.channel === 'amazon') {
    const { pullAmazonOrders } = require('./amazonSync.service');
    const res = await pullAmazonOrders(job.tenantId);
    const summary = `Amazon ${res.fetched} orders: ${res.created} new, ${res.updated} updated, ${res.unchanged} unchanged.`;
    await IntegrationJob.updateOne(
      { _id: job._id },
      { $set: { shortSummary: summary, recordsTotal: res.fetched, recordsProcessed: res.created + res.updated + res.unchanged } },
    ).setOptions({ skipTenantFilter: true });
    return;
  }
  const { pullMyntraOrders } = require('./myntraSync.service');
  const res = await pullMyntraOrders(job.tenantId, {
    from: job.payload?.from,
    to: job.payload?.to,
    userId: job.triggeredByUserId,
  });
  const summary = `Myntra ${res.fetched} orders: ${res.created} new, ${res.updated} updated, ${res.unchanged} unchanged`
    + `${res.failed ? `, ${res.failed} failed` : ''}. SKUs ${res.skus} (${res.unmappedSkus} unmapped).`;
  await IntegrationJob.updateOne(
    { _id: job._id },
    {
      $set: {
        shortSummary: summary,
        recordsTotal: res.fetched,
        recordsProcessed: res.created + res.updated + res.unchanged,
        recordsFailed: res.failed,
      },
    },
  ).setOptions({ skipTenantFilter: true });
  if (res.failed && res.failed === res.fetched) {
    throw new Error(`Myntra order pull failed: ${res.errors[0] || 'unknown error'}`);
  }
}

async function pullPartnerOrders(job) {
  const meta = channelById(job.channel);
  const adapter = adapterFor(job.channel);
  const creds = credsOf(await getConnection(job.tenantId, job.channel));
  const orders = await adapter.pullOrders(creds);
  const { ingestChannelOrders } = require('./channelOrder.service');
  const res = await ingestChannelOrders(job.tenantId, job.channel, orders);
  const summary = `${meta.name} ${res.fetched} orders: ${res.created} new, ${res.updated} updated, ${res.unchanged} unchanged.`;
  await IntegrationJob.updateOne(
    { _id: job._id },
    { $set: { shortSummary: summary, recordsTotal: res.fetched, recordsProcessed: res.created + res.updated + res.unchanged } },
  ).setOptions({ skipTenantFilter: true });
}

async function pullCatalogJob(job) {
  const { pullChannel } = require('./catalogPull.service');
  try {
    const summary = await pullChannel(job.tenantId, job.triggeredByUserId, job.channel);
    const text = `${job.channel} catalog: ${summary.created} created, ${summary.autoMapped} auto-mapped, ${summary.unmapped} unmapped.`;
    await IntegrationJob.updateOne(
      { _id: job._id },
      {
        $set: {
          shortSummary: text,
          recordsTotal: (summary.rows || []).length,
          recordsProcessed: summary.created + summary.autoMapped + summary.unmapped + summary.exists,
          recordsFailed: summary.failed,
        },
      },
    ).setOptions({ skipTenantFilter: true });
  } catch (err) {
    if (err.statusCode === 400) throw terminalError(err.message);
    throw err;
  }
}

async function dispatch(job) {
  if (job.effectApplied) {
    job.shortSummary = 'Already applied. Retry did not reserve again.';
    return;
  }
  if (job.jobType === 'webhook_dispatch') return handleWebhook(job);
  if (job.jobType === 'products_pull') return pullCatalogJob(job);
  if (job.jobType === 'orders_pull') {
    if (!(await hasLiveConnection(job.tenantId, job.channel))) {
      throw terminalError(notLiveMessage(job.channel, job.jobType));
    }
    if (channelById(job.channel)?.kind === 'partner') return pullPartnerOrders(job);
    return pullLiveOrders(job);
  }
  if (job.jobType === 'inventory_push') {
    const { runInventoryJob } = require('./inventoryPush.service');
    await runInventoryJob(job);
    return;
  }
  if (job.jobType === 'shipment_push') {
    const { runShipmentJob } = require('./ship.service');
    const result = await runShipmentJob(job);
    job.shortSummary = `Booked ${result.booked} Delhivery AWBs in one pickup.`;
    return;
  }
  throw terminalError(notLiveMessage(job.channel, job.jobType));
}

async function claimNext() {
  const now = new Date();
  return IntegrationJob.findOneAndUpdate(
    {
      status: 'queued',
      $or: [{ nextRunAt: null }, { nextRunAt: { $lte: now } }],
    },
    { $set: { status: 'running', startedAt: now, lockedAt: now } },
    { sort: { createdAt: 1 }, new: true },
  ).setOptions({ skipTenantFilter: true });
}

async function finishJob(job) {
  const started = Date.now();
  // Long channel pulls must not look stuck to recoverStuck().
  const heartbeat = setInterval(() => {
    IntegrationJob.updateOne({ _id: job._id, status: 'running' }, { $set: { lockedAt: new Date() } })
      .setOptions({ skipTenantFilter: true })
      .catch(() => {});
  }, Math.max(1000, Math.floor(STUCK_MS / 3)));
  try {
    await dispatch(job);
    const fresh = await IntegrationJob.findById(job._id).setOptions({ skipTenantFilter: true });
    if (!fresh) return;
    fresh.status = 'success';
    fresh.finishedAt = new Date();
    fresh.durationMs = Date.now() - started;
    fresh.lastError = '';
    fresh.lockedAt = null;
    if (job.effectApplied && job.shortSummary) fresh.shortSummary = job.shortSummary;
    else if (job.shortSummary && !fresh.shortSummary) fresh.shortSummary = job.shortSummary;
    await fresh.save();
  } catch (err) {
    const fresh = await IntegrationJob.findById(job._id).setOptions({ skipTenantFilter: true });
    if (!fresh) return;
    fresh.lastError = String(err.message || 'Job failed').slice(0, 500);
    fresh.shortSummary = fresh.lastError;
    if (err.terminal) {
      fresh.status = 'failed';
      fresh.lockedAt = null;
      fresh.finishedAt = new Date();
      fresh.durationMs = Date.now() - started;
      await fresh.save();
      await notifyJobFailed(fresh);
      return;
    }
    fresh.retriesCount = (fresh.retriesCount || 0) + 1;
    fresh.lockedAt = null;
    fresh.finishedAt = new Date();
    fresh.durationMs = Date.now() - started;
    const limit = fresh.maxRetries || MAX_RETRIES;
    if (fresh.retriesCount >= limit) {
      fresh.status = 'failed';
      if (fresh.webhookEventId) {
        await WebhookEvent.updateOne(
          { _id: fresh.webhookEventId, applied: { $ne: true } },
          { $set: { status: 'failed', lastError: fresh.lastError } },
        ).setOptions({ skipTenantFilter: true });
      }
    } else {
      fresh.status = 'queued';
      fresh.nextRunAt = new Date(Date.now() + retryDelayMs(fresh.retriesCount));
    }
    await fresh.save();
    await notifyJobFailed(fresh);
    if (fresh.status === 'queued') {
      const delay = Math.max(0, new Date(fresh.nextRunAt || 0).getTime() - Date.now());
      await scheduleBull(fresh, delay);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function recoverStuck(olderThanMs = STUCK_MS) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stuck = await IntegrationJob.find({
    status: 'running',
    lockedAt: { $lte: cutoff },
  }).setOptions({ skipTenantFilter: true });
  for (const job of stuck) {
    job.retriesCount = (job.retriesCount || 0) + 1;
    job.lastError = 'Worker stopped before the job finished. Requeued.';
    job.lockedAt = null;
    const limit = job.maxRetries || MAX_RETRIES;
    if (job.retriesCount >= limit) job.status = 'failed';
    else {
      job.status = 'queued';
      job.nextRunAt = new Date();
    }
    await job.save();
    if (job.status === 'queued') await scheduleBull(job, 0);
  }
  return stuck.length;
}

async function notifyJobFailed(job) {
  if (!job?.tenantId || job.status !== 'failed') return;
  try {
    const { notifyEventEmail } = require('./notify.service');
    await notifyEventEmail(job.tenantId, 'NOT-008', {
      dedupeKey: `job.failed:${job._id}`,
      subject: `Job failed ${job.jobType || ''}`.trim(),
      text: `Job: ${job.jobType || 'integration'}\n${String(job.lastError || 'failed').slice(0, 180)}`,
    });
  } catch (err) {
    console.error('[NOTIFY]', err.message);
  }
}

async function processDueJobs({ limit = 20 } = {}) {
  try {
    const { scanOverdueDispatches } = require('./notify.service');
    await scanOverdueDispatches();
  } catch (err) {
    console.error('[NOTIFY]', err.message);
  }
  await recoverStuck();
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await claimNext();
    if (!job) break;
    processed += 1;
    await finishJob(job);
  }
  return processed;
}

function queueEngine() {
  return bullEnabled() ? 'bullmq' : 'mongo';
}

async function runBullJob(id) {
  await recoverStuck();
  const now = new Date();
  const job = await claimNextId(id, now);
  if (!job) {
    const row = await IntegrationJob.findById(id).setOptions({ skipTenantFilter: true });
    if (row?.status === 'queued' && row.nextRunAt && row.nextRunAt > now) {
      await scheduleBull(row, row.nextRunAt.getTime() - now.getTime());
    }
    return;
  }
  await finishJob(job);
}

async function claimNextId(id, now) {
  return IntegrationJob.findOneAndUpdate(
    {
      _id: id,
      status: 'queued',
      $or: [{ nextRunAt: null }, { nextRunAt: { $lte: now } }],
    },
    { $set: { status: 'running', startedAt: now, lockedAt: now } },
    { new: true },
  ).setOptions({ skipTenantFilter: true });
}

async function kickQueuedJobs() {
  const rows = await IntegrationJob.find({ status: 'queued' }).setOptions({ skipTenantFilter: true });
  for (const row of rows) {
    const delay = Math.max(0, new Date(row.nextRunAt || 0).getTime() - Date.now());
    await scheduleBull(row, delay);
  }
}

function startMongoPoller() {
  if (timer) return;
  const every = Number(process.env.JOB_POLL_MS || 1000);
  timer = setInterval(() => {
    processDueJobs().catch((err) => {
      console.error('[JOBS]', err.message);
    });
  }, every);
  if (typeof timer.unref === 'function') timer.unref();
  console.log('[JOBS] Mongo poller started');
}

async function startJobWorker() {
  if (timer || bullEnabled()) return queueEngine();
  const url = process.env.REDIS_URL
    || (process.env.NODE_ENV === 'test' ? '' : 'redis://127.0.0.1:6379');
  if (url) {
    const started = await startBullTransport(url, runBullJob);
    if (started) {
      await recoverStuck();
      await kickQueuedJobs();
      console.log('[JOBS] BullMQ worker connected');
      return 'bullmq';
    }
    console.error('[JOBS] Redis is not reachable. Using the Mongo poller.');
  }
  startMongoPoller();
  return 'mongo';
}

async function stopJobWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  await stopBullTransport();
}

module.exports = {
  enqueue,
  enqueueManual,
  notLiveMessage,
  listJobs,
  listPlatformJobs,
  requeueJob,
  toJobDto,
  recoverStuck,
  processDueJobs,
  queueEngine,
  startJobWorker,
  stopJobWorker,
};
