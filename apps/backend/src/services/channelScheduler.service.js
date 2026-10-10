const ChannelConnection = require('../models/ChannelConnection');
const IntegrationJob = require('../models/IntegrationJob');
const { credsOf } = require('./channelConnection.service');
const { enqueue } = require('./jobQueue.service');

// Myntra deliveries settle within ~10 days of order creation; older orders rarely change.
const SCHEDULED_LOOKBACK_DAYS = 10;

let timer = null;

function pullReady(row, creds) {
  if (row.status === 'error') return false;
  if (row.channel === 'myntra') return Boolean(creds.merchantId && creds.secretKey);
  if (row.channel === 'shopify') return Boolean(String(creds.shopUrl || '').trim() && String(creds.adminToken || '').trim());
  if (row.channel === 'amazon') return Boolean(creds.sellerId && creds.refreshToken && creds.lwaClientId && creds.lwaClientSecret);
  return false;
}

async function enqueueScheduledPulls(now = new Date()) {
  const rows = await ChannelConnection.find({ channel: { $in: ['shopify', 'amazon', 'myntra'] } }).setOptions({ skipTenantFilter: true });
  let queued = 0;
  for (const row of rows) {
    const creds = credsOf(row);
    if (!pullReady(row, creds)) continue;
    const open = await IntegrationJob.exists({
      tenantId: row.tenantId,
      channel: row.channel,
      jobType: 'orders_pull',
      status: { $in: ['queued', 'running'] },
    }).setOptions({ skipTenantFilter: true });
    if (open) continue;
    await enqueue({
      tenantId: row.tenantId,
      channel: row.channel,
      jobType: 'orders_pull',
      triggeredBy: 'scheduler',
      payload: { from: new Date(now.getTime() - SCHEDULED_LOOKBACK_DAYS * 864e5).toISOString() },
    });
    queued += 1;
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
  }, minutes * 60_000);
  if (typeof timer.unref === 'function') timer.unref();
}

function stopChannelScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { enqueueScheduledPulls, startChannelScheduler, stopChannelScheduler };
