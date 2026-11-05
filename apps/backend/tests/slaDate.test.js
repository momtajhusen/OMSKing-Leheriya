const test = require('node:test');
const assert = require('node:assert/strict');
const amazon = require('../src/adapters/amazon');
const channelConnection = require('../src/services/channelConnection.service');
const channelOrder = require('../src/services/channelOrder.service');
const { toOrderDto } = require('../src/lib/orderDto');

const creds = { apiMode: 'sandbox', sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's' };

test('Amazon order pull keeps LatestShipDate as the ship-by (SLA) date', async () => {
  const replies = [
    { status: 200, text: JSON.stringify({ access_token: 'token' }) },
    { status: 200, text: JSON.stringify({ payload: { Orders: [{
      AmazonOrderId: '402-1', OrderStatus: 'Unshipped', PurchaseDate: '2026-11-01T08:09:00Z',
      LatestShipDate: '2026-11-02T08:30:00Z', OrderTotal: { Amount: '999' }, NumberOfItemsUnshipped: 1,
    }] } }) },
  ];
  const rows = await amazon.pullOrders(creds, { request: async () => replies.shift() });
  assert.equal(rows[0].shipByTime.toISOString(), '2026-11-02T08:30:00.000Z');
});

test('Amazon sync saves the ship-by date on the order channel line', async () => {
  const saved = [];
  const original = {
    getConnection: channelConnection.getConnection,
    credsOf: channelConnection.credsOf,
    claimChannelOrder: channelOrder.claimChannelOrder,
    finishChannelOrder: channelOrder.finishChannelOrder,
    pullOrders: amazon.pullOrders,
  };
  channelConnection.getConnection = async () => ({});
  channelConnection.credsOf = () => creds;
  channelOrder.claimChannelOrder = async (_key, next) => { saved.push(next); return { doc: next, created: true }; };
  channelOrder.finishChannelOrder = async () => 'created';
  amazon.pullOrders = async () => [{
    externalOrderId: '402-1', status: 'Ready to Ship', total: 999, orderDate: new Date('2026-11-01T08:09:00Z'),
    shipByTime: new Date('2026-11-02T08:30:00Z'), items: [{ name: 'Kurta', sku: 'K1', qty: 1, price: 999 }],
  }];
  try {
    delete require.cache[require.resolve('../src/services/amazonSync.service')];
    const { pullAmazonOrders } = require('../src/services/amazonSync.service');
    await pullAmazonOrders('tenant-1');
  } finally {
    Object.assign(channelConnection, { getConnection: original.getConnection, credsOf: original.credsOf });
    Object.assign(channelOrder, { claimChannelOrder: original.claimChannelOrder, finishChannelOrder: original.finishChannelOrder });
    amazon.pullOrders = original.pullOrders;
    delete require.cache[require.resolve('../src/services/amazonSync.service')];
  }
  assert.equal(saved[0].channelLines[0].shipByTime.toISOString(), '2026-11-02T08:30:00.000Z');
});

test('order DTO has an SLA date only for Amazon and Myntra orders (earliest line ship-by)', () => {
  const lines = [
    { sku: 'A', shipByTime: new Date('2026-11-03T08:30:00Z') },
    { sku: 'B', shipByTime: new Date('2026-11-02T08:30:00Z') },
  ];
  const base = { orderNo: 'O-1', items: [], subOrders: [], channelLines: lines };
  assert.equal(toOrderDto({ ...base, channel: 'Myntra' }).slaDate.toISOString(), '2026-11-02T08:30:00.000Z');
  assert.equal(toOrderDto({ ...base, channel: 'Amazon' }).slaDate.toISOString(), '2026-11-02T08:30:00.000Z');
  assert.equal(toOrderDto({ ...base, channel: 'Shopify' }).slaDate, null);
  assert.equal(toOrderDto({ ...base, channel: 'Amazon', channelLines: [] }).slaDate, null);
});
