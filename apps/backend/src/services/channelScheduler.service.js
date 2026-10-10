const ChannelConnection = require('../models/ChannelConnection');
const IntegrationJob = require('../models/IntegrationJob');
const Tenant = require('../models/Tenant');
const { credsOf } = require('./channelConnection.service');
const { enqueue, keysReady } = require('./jobQueue.service');

// Myntra deliveries settle within ~10 days of order creation; older orders rarely change.
const SCHEDULED_LOOKBACK_DAYS = 10;

let timer = null;

function pullReady(row, creds) {
  if (row.status === 'error') return false;
  if (!['shopify', 'amazon', 'myntra'].includes(row.channel)) return false;
  return keysReady(row.channel, creds);
}

async function enqueueIdle(row, jobType, payload) {
  const open = await IntegrationJob.exists({
    tenantId: row.tenantId,
    channel: row.channel,
    jobType,
    status: { $in: ['queued', 'running'] },
  }).setOptions({ skipTenantFilter: true });
  if (open) return false;
  await enqueue({
    tenantId: row.tenantId,
    channel: row.channel,
    jobType,
    triggeredBy: 'scheduler',
    payload,
  });
  return true;
}

async function enqueueScheduledPulls(now = new Date()) {
  const rows = await ChannelConnection.find({ channel: { $in: ['shopify', 'amazon', 'myntra'] } }).setOptions({ skipTenantFilter: true });
  const from = new Date(now.getTime() - SCHEDULED_LOOKBACK_DAYS * 864e5).toISOString();
  let queued = 0;
  for (const row of rows) {
    const creds = credsOf(row);
    if (!pullReady(row, creds)) continue;
    const payload = { from };
    if (await enqueueIdle(row, 'orders_pull', payload)) queued += 1;
    if (await enqueueIdle(row, 'products_pull', payload)) queued += 1;
    if (await enqueueIdle(row, 'return_pull', payload)) queued += 1;
    if (row.channel !== 'shopify') continue;
    const tenant = await Tenant.findById(row.tenantId).setOptions({ skipTenantFilter: true });
    if (tenant?.settings?.inventoryAuthority !== 'shopify') continue;
    if (await enqueueIdle(row, 'inventory_push', {})) queued += 1;
  }
  return queued;
}

let minutesApplied = 0;

async function startChannelScheduler() {
  const { orderPullMinutes } = require('./platformSettings.service');
  const minutes = await orderPullMinutes();
  if (timer && minutesApplied === minutes) return;
  if (timer) clearInterval(timer);
  timer = null;
  minutesApplied = minutes;
  if (!(minutes > 0)) return;
  timer = setInterval(() => {
    enqueueScheduledPulls().catch((err) => console.error('[SCHEDULER]', err.message));
    const { pollActiveCouriers } = require('./tracking.service');
    pollActiveCouriers().catch((err) => console.error('[TRACK]', err.message));
    const { runDueManifests } = require('./ship.service');
    runDueManifests().catch((err) => console.error('[PICKUP]', err.message));
  }, minutes * 60_000);
  if (typeof timer.unref === 'function') timer.unref();
}

function stopChannelScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { enqueueScheduledPulls, startChannelScheduler, stopChannelScheduler, pullReady };
