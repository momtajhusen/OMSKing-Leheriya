const ChannelConnection = require('../models/ChannelConnection');
const IntegrationJob = require('../models/IntegrationJob');
const { credsOf } = require('./channelConnection.service');
const { enqueue } = require('./jobQueue.service');

// Myntra deliveries settle within ~10 days of order creation; older orders rarely change.
const SCHEDULED_LOOKBACK_DAYS = 10;

let timer = null;

async function enqueueScheduledPulls(now = new Date()) {
  const rows = await ChannelConnection.find({ channel: 'myntra' }).setOptions({ skipTenantFilter: true });
  let queued = 0;
  for (const row of rows) {
    const creds = credsOf(row);
    if (!creds.merchantId || !creds.secretKey || row.status === 'error') continue;
    const open = await IntegrationJob.exists({
      tenantId: row.tenantId,
      channel: 'myntra',
      jobType: 'orders_pull',
      status: { $in: ['queued', 'running'] },
    }).setOptions({ skipTenantFilter: true });
    if (open) continue;
    await enqueue({
      tenantId: row.tenantId,
      channel: 'myntra',
      jobType: 'orders_pull',
      triggeredBy: 'scheduler',
      payload: { from: new Date(now.getTime() - SCHEDULED_LOOKBACK_DAYS * 864e5).toISOString() },
    });
    queued += 1;
  }
  return queued;
}

function startChannelScheduler() {
  const minutes = Number(process.env.MYNTRA_PULL_MINUTES || 15);
  if (timer || !(minutes > 0)) return;
  timer = setInterval(() => {
    enqueueScheduledPulls().catch((err) => console.error('[SCHEDULER]', err.message));
  }, minutes * 60_000);
  if (typeof timer.unref === 'function') timer.unref();
}

function stopChannelScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { enqueueScheduledPulls, startChannelScheduler, stopChannelScheduler };
