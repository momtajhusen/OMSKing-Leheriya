const shopify = require('../adapters/shopify');
const amazon = require('../adapters/amazon');
const myntra = require('../adapters/myntra');
const { getConnection, credsOf } = require('./channelConnection.service');
const { ingestReturns } = require('./returnsFlow.service');

async function pullChannelReturns(tenantId, channel, deps = {}) {
  const creds = credsOf(await getConnection(tenantId, channel));
  let rows = [];
  if (channel === 'shopify') {
    rows = await shopify.pullReturns(creds, { request: deps.shopifyRequest });
  } else if (channel === 'amazon') {
    rows = await amazon.pullReturns(creds, { request: deps.amazonRequest });
  } else if (channel === 'myntra') {
    rows = await myntra.pullReturns(creds, { client: deps.myntraClient, from: deps.from, to: deps.to });
  } else {
    const err = new Error(`${channel} returns are not pulled.`);
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  const ingested = await ingestReturns(tenantId, rows);
  return {
    fetched: rows.length,
    saved: ingested.saved,
    createdOrder: ingested.createdOrder,
  };
}

module.exports = { pullChannelReturns };
