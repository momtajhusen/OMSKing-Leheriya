const { HttpError } = require('../utils/httpError');

/**
 * Pull recent orders from live channels right now (no job queue).
 * Used when the Orders page opens / refreshes, and by Sync Orders.
 */
async function pullOrdersNow(tenantId, { hours = 48, channels } = {}) {
  const { hasLiveConnection } = require('./jobQueue.service');
  const from = new Date(Date.now() - Math.max(1, Number(hours) || 48) * 3600e3).toISOString();
  const list = Array.isArray(channels) && channels.length
    ? channels.map((c) => String(c).toLowerCase())
    : ['shopify', 'amazon', 'myntra'];
  const results = [];

  for (const channel of list) {
    if (!(await hasLiveConnection(tenantId, channel))) {
      results.push({ channel, status: 'skipped', shortSummary: 'not connected', created: 0, updated: 0, unchanged: 0, fetched: 0 });
      continue;
    }
    try {
      const one = await pullOneChannelNow(tenantId, channel, from);
      results.push(one);
    } catch (err) {
      results.push({
        channel,
        status: 'failed',
        lastError: String(err.message || 'Pull failed').slice(0, 300),
        shortSummary: String(err.message || 'Pull failed').slice(0, 300),
        created: 0,
        updated: 0,
        unchanged: 0,
        fetched: 0,
      });
    }
  }
  return results;
}

async function pullOneChannelNow(tenantId, channel, from) {
  const { ingestChannelOrders } = require('./channelOrder.service');

  if (channel === 'shopify') {
    const shopify = require('../adapters/shopify');
    const creds = await require('./shopifyAuth.service').shopifyCreds(tenantId);
    const orders = await shopify.pullOrders(creds, { from });
    const res = await ingestChannelOrders(tenantId, 'shopify', orders);
    return {
      channel,
      status: 'success',
      fetched: orders.length,
      created: res.created,
      updated: res.updated,
      unchanged: res.unchanged,
      shortSummary: `Shopify ${orders.length} orders: ${res.created} new, ${res.updated} updated, ${res.unchanged} unchanged.`,
    };
  }

  if (channel === 'amazon') {
    const { pullAmazonOrders } = require('./amazonSync.service');
    const res = await pullAmazonOrders(tenantId, {});
    return {
      channel,
      status: 'success',
      fetched: res.fetched,
      created: res.created,
      updated: res.updated,
      unchanged: res.unchanged,
      shortSummary: `Amazon ${res.fetched} orders: ${res.created} new, ${res.updated} updated, ${res.unchanged} unchanged.`,
    };
  }

  if (channel === 'myntra') {
    const { pullMyntraOrders } = require('./myntraSync.service');
    const res = await pullMyntraOrders(tenantId, {});
    return {
      channel,
      status: 'success',
      fetched: res.fetched,
      created: res.created,
      updated: res.updated,
      unchanged: res.unchanged,
      shortSummary: `Myntra ${res.fetched} orders: ${res.created} new, ${res.updated} updated, ${res.unchanged} unchanged.`,
    };
  }

  throw new HttpError(400, `Unknown channel: ${channel}`);
}

module.exports = { pullOrdersNow, pullOneChannelNow };
