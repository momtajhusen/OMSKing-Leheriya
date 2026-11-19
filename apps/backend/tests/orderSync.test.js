process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const ChannelConnection = require('../src/models/ChannelConnection');
const { encryptObject } = require('../src/lib/secretBox');
const { syncShopifyOrder } = require('../src/services/orderSync.service');
const shopify = require('../src/adapters/shopify');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('pullOneOrder maps a single Shopify Admin order', async () => {
  const mapped = await shopify.pullOneOrder(
    { shopUrl: 'demo.myshopify.com', adminToken: 'shpat_test' },
    '19115190616157',
    {
      request: async () => ({
        status: 200,
        text: JSON.stringify({
          order: {
            id: 19115190616157,
            name: '#70027-LEH',
            created_at: '2026-11-19T10:01:00+05:30',
            financial_status: 'pending',
            fulfillment_status: null,
            current_total_price: '4999.00',
            total_price: '4999.00',
            currency: 'INR',
            email: 'fareeskhan1975@gmail.com',
            shipping_address: {
              name: 'Hum khan khan',
              phone: '9673236000',
              address1: 'Shivaj Chowk',
              city: 'Latur',
              province: 'MH',
              zip: '413512',
            },
            line_items: [{ title: 'Suit', sku: 'LEHE2526', quantity: 1, price: '4999.00' }],
            payment_gateway_names: ['Cash on Delivery (COD)'],
          },
        }),
      }),
    },
  );
  assert.equal(mapped.externalOrderId, '19115190616157');
  assert.equal(mapped.channelOrderNo, '#70027-LEH');
  assert.equal(mapped.customer, 'Hum khan khan');
  assert.equal(mapped.items[0].sku, 'LEHE2526');
});

test('Single Order Sync refreshes address and phone from Shopify', async () => {
  const tenant = await Tenant.create({ name: 'Leheriya', slug: `sync-${Date.now()}`, kind: 'merchant' });
  await ChannelConnection.create({
    tenantId: tenant._id,
    channel: 'shopify',
    status: 'connected',
    credentialsEnc: encryptObject({ shopUrl: 'demo.myshopify.com', adminToken: 'shpat_test' }),
  });
  await Order.create({
    tenantId: tenant._id,
    orderNo: 'SHP-19115190616157',
    channel: 'Shopify',
    status: 'New',
    paymentMode: 'COD',
    externalOrderId: '19115190616157',
    channelOrderNo: '70027-LEH',
    customer: 'Old Name',
    phone: '9000000000',
    address: 'Old street',
    city: 'Latur 413512',
    total: 4999,
    items: [{ name: 'Suit', sku: 'LEHE2526', qty: 1, price: 4999 }],
    source: 'channel_api',
  });
  const { order, result } = await syncShopifyOrder(tenant._id, 'SHP-19115190616157', {
    shopifyCreds: { shopUrl: 'demo.myshopify.com', adminToken: 'shpat_test' },
    shopifyRequest: async () => ({
      status: 200,
      text: JSON.stringify({
        order: {
          id: 19115190616157,
          name: '#70027-LEH',
          created_at: '2026-11-19T10:01:00+05:30',
          financial_status: 'pending',
          current_total_price: '4999.00',
          total_price: '4999.00',
          currency: 'INR',
          email: 'fareeskhan1975@gmail.com',
          shipping_address: {
            name: 'Hum khan khan',
            phone: '9673236000',
            address1: 'Shivaj Chowk Ambejogai Road',
            city: 'Latur',
            province: 'MH',
            zip: '413512',
          },
          line_items: [{ title: 'Suit', sku: 'LEHE2526', quantity: 1, price: '4999.00' }],
          payment_gateway_names: ['Cash on Delivery (COD)'],
        },
      }),
    }),
  });
  assert.equal(result.updated, 1);
  assert.equal(order.customer, 'Hum khan khan');
  assert.equal(order.phone, '9673236000');
  assert.match(order.address, /Shivaj Chowk/);
});
