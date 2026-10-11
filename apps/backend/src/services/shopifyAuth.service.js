const { getConnection, credsOf, patchCreds } = require('./channelConnection.service');
const shopify = require('../adapters/shopify');

async function shopifyCreds(tenantId, opts = {}) {
  const row = await getConnection(tenantId, 'shopify');
  if (!row) return {};
  const current = credsOf(row);
  const next = await shopify.ensureShopifyCreds(current, opts);
  if (next.adminToken && (next.adminToken !== current.adminToken || next.tokenExpiresAt !== current.tokenExpiresAt)) {
    await patchCreds(row, {
      adminToken: next.adminToken,
      tokenExpiresAt: next.tokenExpiresAt || '',
    });
  }
  return next;
}

module.exports = { shopifyCreds };
