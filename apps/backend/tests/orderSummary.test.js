const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderSummary } = require('../src/services/orderSummary.service');

describe('order summary', () => {
  it('counts a dashboard from order rows without returning the whole book', () => {
    const now = new Date().toISOString();
    const orders = [
      {
        id: 'A', status: 'New', total: 100, channel: 'Shopify', createdAt: now,
        items: [{ sku: 'K1', name: 'Kurta', qty: 2, price: 50 }], subOrders: [],
      },
      {
        id: 'B', status: 'Cancelled', total: 500, channel: 'Shopify', createdAt: now,
        items: [{ sku: 'K2', name: 'Saree', qty: 1, price: 500 }], subOrders: [],
      },
      {
        id: 'C', status: 'Delivered', total: 40, channel: 'Amazon', createdAt: now, invoiceNo: '',
        items: [{ sku: 'K1', name: 'Kurta', qty: 1, price: 40 }],
        subOrders: [],
        reversePickup: { returnId: 'R1' },
      },
    ];
    const summary = buildOrderSummary(orders, {
      channel: 'all',
      days: 'all',
      series: [{ id: 'shopify', label: 'Shopify' }, { id: 'amazon', label: 'Amazon' }],
      tzOffset: new Date().getTimezoneOffset(),
    });
    assert.equal(summary.total, 3);
    assert.equal(summary.newOrders, 1);
    assert.equal(summary.revenue, 140);
    assert.equal(summary.returns, 1);
    assert.equal(summary.missingInvoice, 1);
    assert.equal(summary.counts.all, 3);
    assert.equal(summary.counts.New, 1);
    assert.equal(summary.recent.all.length, 3);
    assert.equal(summary.recent.all[0].items, undefined);
    assert.ok(summary.recent.all[0].id);
    assert.equal(summary.top[0].sku, 'K1');
    assert.equal(summary.top[0].units, 3);
    assert.equal(summary.channels.find((row) => row.channel === 'Shopify').revenue, 100);
    assert.equal(summary.channels.find((row) => row.channel === 'Amazon').orders, 1);
    assert.equal(summary.trend.length, 14);
  });
});
