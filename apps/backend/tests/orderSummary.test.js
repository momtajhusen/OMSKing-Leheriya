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
    assert.equal(summary.returns, 0);
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

  it('problem invoices: Shopify delivered unpaid 45+ days, Amazon/Myntra delivered without payment in the report', () => {
    const old = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const row = (id, channel, createdAt, extra = {}) => ({
      id, channel, createdAt, status: 'Delivered', total: 100, invoiceNo: 'INV', items: [], subOrders: [], ...extra,
    });
    const orders = [
      row('S-OLD', 'Shopify', old),
      row('S-RECENT', 'Shopify', recent),
      row('S-PAID', 'Shopify', old, { paymentStatus: 'paid' }),
      row('S-FIN', 'Shopify', old),
      row('S-SHIPPED', 'Shopify', old, { status: 'Dispatched' }),
      row('A-NOPAY', 'Amazon', recent),
      row('A-PAID', 'Amazon', recent, { paymentStatus: 'paid' }),
      row('M-NOPAY', 'Myntra', old),
      row('M-PAID', 'Myntra', old, { paymentStatus: 'paid' }),
      row('W-OLD', 'Website', old),
      row('S-CANCEL', 'Shopify', old, { status: 'Cancelled' }),
    ];
    const summary = buildOrderSummary(orders, { settledOrderNos: ['S-FIN'] });
    assert.equal(summary.missingInvoice, 3);
  });

  it('counts new orders per channel for the dashboard channel cards', () => {
    const now = new Date().toISOString();
    const orders = [
      { id: 'A', status: 'New', total: 100, channel: 'Shopify', createdAt: now, items: [], subOrders: [] },
      { id: 'B', status: 'New', total: 200, channel: 'Shopify', createdAt: now, items: [], subOrders: [] },
      { id: 'C', status: 'Delivered', total: 40, channel: 'Myntra', createdAt: now, items: [], subOrders: [] },
      { id: 'D', status: 'New', total: 60, channel: 'Amazon', createdAt: now, items: [], subOrders: [] },
    ];
    const summary = buildOrderSummary(orders, {
      channel: 'all',
      days: 'all',
      series: [{ id: 'shopify', label: 'Shopify' }, { id: 'myntra', label: 'Myntra' }, { id: 'amazon', label: 'Amazon' }],
      tzOffset: 0,
    });
    const row = (label) => summary.channels.find((entry) => entry.channel === label);
    assert.equal(summary.newOrders, 3);
    assert.equal(row('Shopify').newOrders, 2);
    assert.equal(row('Myntra').newOrders, 0);
    assert.equal(row('Amazon').newOrders, 1);
  });

  it('counts Return issues: channel orders shipped 45+ days ago that were neither delivered nor returned back', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const old = new Date(Date.now() - 50 * DAY).toISOString();
    const recent = new Date(Date.now() - 10 * DAY).toISOString();
    const order = (id, channel, extra = {}) => ({
      id, status: 'Dispatched', total: 10, channel, createdAt: old, items: [], subOrders: [], ...extra,
    });
    const orders = [
      order('S-TRANSIT', 'Shopify'),
      order('S-INTRANSIT', 'Shopify', { status: 'In transit', paymentStatus: 'unpaid' }),
      order('A-RTO', 'Amazon', { channelStatus: 'RTO' }),
      order('M-RETURN', 'Myntra', { status: 'Delivered' }),
      order('S-REVERSE', 'Shopify', { status: 'Delivered', reversePickup: { returnId: 'RET-REV-S' } }),
      order('M-BACK', 'Myntra', { status: 'Delivered' }),
      order('A-RTO-BACK', 'Amazon', { channelStatus: 'RTO' }),
      order('M-REJECTED', 'Myntra', { status: 'Delivered' }),
      order('A-DELIVERED', 'Amazon', { status: 'Delivered' }),
      order('S-YOUNG', 'Shopify', { createdAt: recent }),
      order('S-CANCEL', 'Shopify', { status: 'Cancelled' }),
      order('S-VOID', 'Shopify', { paymentMode: 'Void' }),
      order('S-PAID', 'Shopify', { paymentStatus: 'paid' }),
      order('S-SHOPIFY-PAID', 'Shopify'),
      order('S-UNSHIPPED', 'Shopify', { status: 'New' }),
      order('O-OFFLINE', 'Offline'),
    ];
    const returnRows = [
      { orderNo: 'M-RETURN', status: 'Approved' },
      { orderNo: 'M-BACK', status: 'Completed' },
      { orderNo: 'A-RTO-BACK', status: 'Completed' },
      { orderNo: 'M-REJECTED', status: 'Rejected' },
    ];
    const opts = { channel: 'all', days: 'all', returnRows, settledOrderNos: ['S-SHOPIFY-PAID'] };
    assert.equal(buildOrderSummary(orders, opts).returns, 5);
    assert.equal(buildOrderSummary(orders, { ...opts, channel: 'Myntra' }).returns, 1);
    assert.equal(buildOrderSummary(orders, { ...opts, days: '7' }).returns, 5);
  });

  it('limits the dashboard to a custom from–to date range', () => {
    const order = (id, createdAt) => ({
      id, status: 'New', total: 10, channel: 'Shopify', createdAt, items: [], subOrders: [],
    });
    const orders = [
      order('A', '2026-10-01T10:00:00.000Z'),
      order('B', '2026-10-02T00:30:00.000Z'),
      order('C', '2026-10-05T12:00:00.000Z'),
      order('D', '2026-10-10T23:30:00.000Z'),
      order('E', '2026-10-11T00:10:00.000Z'),
    ];
    const series = [{ id: 'shopify', label: 'Shopify' }];
    const summary = buildOrderSummary(orders, {
      days: 'all', from: '2026-10-02', to: '2026-10-10', series, tzOffset: 0,
    });
    assert.equal(summary.total, 3);
    assert.deepEqual(summary.recent.all.map((row) => row.id).sort(), ['B', 'C', 'D']);
    assert.equal(summary.trend.length, 9);
    assert.equal(summary.trend[0].date, '10-02');
    assert.equal(summary.trend[8].date, '10-10');
    assert.equal(summary.trend[3].shopify, 1);

    const swapped = buildOrderSummary(orders, { from: '2026-10-10', to: '2026-10-02', series, tzOffset: 0 });
    assert.equal(swapped.total, 3);

    const ist = buildOrderSummary(orders, { from: '2026-10-11', to: '2026-10-11', series, tzOffset: -330 });
    assert.deepEqual(ist.recent.all.map((row) => row.id).sort(), ['D', 'E']);
    assert.equal(ist.trend.length, 1);

    const invalid = buildOrderSummary(orders, { days: 'all', from: 'nope', to: '2026-02-31', series, tzOffset: 0 });
    assert.equal(invalid.total, 5);
  });
});
