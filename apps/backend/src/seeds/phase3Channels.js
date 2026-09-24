const ChannelConnection = require('../models/ChannelConnection');
const { upsertConnection, credsOf, recordTest } = require('../services/channelConnection.service');
const { pingChannel } = require('../services/channelPing.service');

async function seedLeheriyaChannels(tenantId) {
  if (process.env.MYNTRA_MERCHANT_ID && process.env.MYNTRA_SECRET_KEY) {
    await upsertConnection(tenantId, null, 'myntra', {
      warehouseCode: process.env.MYNTRA_STORE_ID || '',
      credentials: {
        merchantId: process.env.MYNTRA_MERCHANT_ID,
        secretKey: process.env.MYNTRA_SECRET_KEY,
        token: process.env.MYNTRA_TOKEN || '',
        storeId: process.env.MYNTRA_STORE_ID || '',
        warehouseCode: process.env.MYNTRA_STORE_ID || '',
        vmsMode: 'online',
        mnowAlertEmail: process.env.MYNTRA_ALERT_EMAIL || '',
      },
    });
  }

  const amazonReady = process.env.AMAZON_LWA_CLIENT_ID || process.env.AMAZON_SELLER_ID || process.env.AMAZON_REFRESH_TOKEN;
  if (amazonReady) {
    await upsertConnection(tenantId, null, 'amazon', {
      credentials: {
        sellerId: process.env.AMAZON_SELLER_ID || '',
        partnerAccountId: process.env.AMAZON_PARTNER_ACCOUNT_ID || '',
        applicationId: process.env.AMAZON_APPLICATION_ID || '',
        marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'A21TJRUUN4KGV',
        refreshToken: process.env.AMAZON_REFRESH_TOKEN || '',
        lwaClientId: process.env.AMAZON_LWA_CLIENT_ID || '',
        lwaClientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || '',
        processSelfFulfilled: process.env.AMAZON_PROCESS_SELF_FULFILLED || '1',
      },
    });
  }

  if (process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_ADMIN_TOKEN) {
    await upsertConnection(tenantId, null, 'shopify', {
      credentials: {
        shopUrl: process.env.SHOPIFY_SHOP_URL || '',
        clientId: process.env.SHOPIFY_CLIENT_ID || '',
        apiSecret: process.env.SHOPIFY_API_SECRET || '',
        adminToken: process.env.SHOPIFY_ADMIN_TOKEN || '',
      },
    });
  }
}

async function testSeededChannels(tenantId) {
  const rows = await ChannelConnection.find({ tenantId }).setOptions({ skipTenantFilter: true });
  const out = [];
  for (const row of rows) {
    const result = await pingChannel(row.channel, credsOf(row));
    await recordTest(row, result);
    out.push({ channel: row.channel, ok: result.ok, message: result.message });
  }
  return out;
}

module.exports = { seedLeheriyaChannels, testSeededChannels };
