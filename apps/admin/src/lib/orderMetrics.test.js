import fs from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCancelled, netSales, grossSales, salesByChannel, refundsByOrder, isRto, sumMoney, istDate, istMonth,
  shippingStats, vendorReportLines, refundRows,
} from './orderMetrics.js';

describe('dashboard net sales', () => {
  it('excludes cancelled orders from the total', () => {
    const orders = [
      { status: 'New', total: 100, items: [{ sku: 'KURTA', qty: 1 }] },
      { status: 'Cancelled', total: 500, items: [{ sku: 'SAREE', qty: 2 }] },
      { status: 'Delivered', total: 40, items: [{ sku: 'KURTA', qty: 1 }] },
    ];
    assert.equal(isCancelled(orders[1]), true);
    assert.equal(netSales(orders), 140);
  });

  it('matches the backend rule: drop Cancelled and RTO, subtract refunded returns, sum in paise', () => {
    const orders = [
      { id: 'A', status: 'Delivered', total: 0.1, channel: 'Shopify' },
      { id: 'B', status: 'Delivered', total: 0.2, channel: 'Shopify' },
      { id: 'C', status: 'Cancelled', total: 500, channel: 'Shopify' },
      { id: 'D', status: 'Dispatched', total: 300, channel: 'Shopify', channelStatus: 'RTO' },
      { id: 'E', status: 'RTO In Transit', total: 200, channel: 'Shopify' },
      { id: 'F', status: 'Delivered', total: 1000, channel: 'Amazon' },
    ];
    const refunds = refundsByOrder([
      { orderId: 'F', refundStatus: 'refunded', refundAmount: 250.45 },
      { orderId: 'F', refundStatus: 'pending', refundAmount: 99 },
      { orderId: 'D', refundStatus: 'refunded', refundAmount: 300 },
    ]);
    assert.equal(netSales(orders, refunds), 749.85);
    assert.equal(grossSales(orders), 1500.3);
    assert.deepEqual(salesByChannel(orders, ['Shopify', 'Amazon'], refunds).map((row) => row.revenue), [0.3, 749.55]);
    assert.equal(sumMoney([0.1, 0.2, 0.7]), 1);
  });
});

describe('shared shipping rule and IST dates', () => {
  it('RTO is an RTO status or an RTO channel code; customer returns are not RTO', () => {
    assert.equal(isRto({ status: 'Dispatched', channelStatus: 'RTO' }), true);
    assert.equal(isRto({ status: 'Cancelled', channelLines: [{ status: 'RTO' }] }), true);
    assert.equal(isRto({ status: 'RTO In Transit' }), true);
    assert.equal(isRto({ status: 'Delivered', reversePickup: { returnId: 'R1' } }), false);
    assert.equal(isRto({ status: 'Ready to Ship' }), false);
  });

  it('istDate and istMonth use the Asia/Kolkata calendar', () => {
    assert.equal(istDate(new Date('2026-10-31T19:00:00.000Z')), '2026-11-01');
    assert.equal(istDate('2026-10-31T18:00:00.000Z'), '2026-10-31');
    assert.equal(istMonth('2026-10-31T19:00:00.000Z'), '2026-11');
    assert.equal(istMonth('2026-10-05'), '2026-10');
    assert.equal(istDate(''), '');
    assert.equal(istMonth('nope'), '');
  });

  it('report shipping stats: in transit covers Dispatched and In transit without RTO; RTO excludes customer returns', () => {
    const stats = shippingStats([
      { id: '1', awb: 'A1', status: 'Dispatched' },
      { id: '2', awb: 'A2', status: 'In transit' },
      { id: '3', awb: 'A3', status: 'Dispatched', channelStatus: 'RTO' },
      { id: '4', awb: 'A4', status: 'Delivered', reversePickup: { returnId: 'R1' } },
      { id: '5', awb: 'A5', status: 'Cancelled' },
      { id: '6', status: 'New' },
    ]);
    assert.equal(stats.total, 5);
    assert.equal(stats.inTransit, 2);
    assert.equal(stats.rto, 1);
    assert.equal(stats.delivered, 1);
    assert.equal(stats.cancelledAfterDispatch, 1);
  });
});

describe('report vendor lines', () => {
  it('drops cancelled / rejected lines and lines of cancelled orders', () => {
    const orders = [
      { id: 'M1', status: 'Delivered', createdAt: '2026-10-31T19:00:00.000Z', subOrders: [
        { id: 'M1-1', assignedVendor: 'Asha', price: 100.1, vendorStatus: 'Delivered' },
        { id: 'M1-2', assignedVendor: 'Asha', price: 50, vendorStatus: 'Rejected' },
        { id: 'M1-3', assignedVendor: 'Asha', price: 70, status: 'Cancelled' },
        { id: 'M1-4', assignedVendor: '', price: 10 },
      ] },
      { id: 'M2', status: 'Cancelled', subOrders: [{ id: 'M2-1', assignedVendor: 'Asha', price: 900 }] },
    ];
    const lines = vendorReportLines(orders, (name) => name.toUpperCase());
    assert.deepEqual(lines.map((line) => line.sub.id), ['M1-1']);
    assert.equal(lines[0].vendor, 'ASHA');
    assert.equal(lines[0].month, '2026-11');
  });
});

describe('returns & refunds reconciliation rows', () => {
  const orders = [
    { id: 'RET', status: 'Delivered', total: 3000, paymentMode: 'Prepaid', reversePickup: { returnId: 'R-1' }, createdAt: '2026-10-02' },
    { id: 'RET-NOREC', status: 'Delivered', total: 400, paymentMode: 'Prepaid', reversePickup: { returnId: 'R-2' }, createdAt: '2026-10-01' },
    { id: 'RTO-OPEN', status: 'Dispatched', channelStatus: 'RTO', awb: 'X', total: 800, paymentMode: 'Prepaid', createdAt: '2026-10-03' },
    { id: 'CAN', status: 'Cancelled', total: 200, paymentMode: 'COD', createdAt: '2026-10-04' },
    { id: 'LIVE', status: 'Dispatched', awb: 'Y', total: 50, createdAt: '2026-10-05' },
  ];
  const returns = [
    { id: 'R-1', orderId: 'RET', kind: 'customer', refundAmount: 0, amount: 1200 },
    { id: 'R-9', orderId: 'RET', kind: 'customer', refundAmount: 0, amount: 300 },
  ];
  const rows = refundRows(orders, {}, returns);

  it('a customer return refunds the return value, not the whole order', () => {
    assert.equal(rows.find((row) => row.order.id === 'RET').refund, 1500);
    assert.equal(rows.find((row) => row.order.id === 'RET-NOREC').refund, 400);
  });

  it('an RTO order still on Dispatched is listed as cancelled after dispatch', () => {
    const rto = rows.find((row) => row.order.id === 'RTO-OPEN');
    assert.equal(rto.kind, 'Cancelled after dispatch (RTO)');
    assert.equal(rto.refund, 800);
    assert.ok(!rows.some((row) => row.order.id === 'LIVE'));
    assert.deepEqual(rows.map((row) => row.order.id), ['CAN', 'RTO-OPEN', 'RET', 'RET-NOREC']);
  });

  it('refundAmount wins over the return line value when set', () => {
    const paid = refundRows(orders, {}, [{ id: 'R-1', orderId: 'RET', kind: 'customer', refundAmount: 999.5, amount: 1200 }]);
    assert.equal(paid.find((row) => row.order.id === 'RET').refund, 999.5);
  });
});

describe('pages use the shared helpers', () => {
  const read = (file) => fs.readFileSync(new URL(`../pages/admin/${file}`, import.meta.url), 'utf8');

  it('Orders CSV date and file name are IST days', () => {
    const page = read('OrdersPage.jsx');
    assert.doesNotMatch(page, /String\(order\.createdAt\)\.slice\(0, 10\)/);
    assert.doesNotMatch(page, /orders-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}/);
    assert.match(page, /istDate\(order\.createdAt\)/);
  });

  it('Returns & Refunds reconciliation builds rows from refundRows with the API returns', () => {
    const page = read('ReturnsRefundsReconciliationPage.jsx');
    assert.match(page, /refundRows\(orders, workflow, returnRows\)/);
    assert.match(page, /sumMoney\(/);
    assert.doesNotMatch(page, /refund: order\.total/);
  });

  it('Dashboard shows net sales with gross on hover and in the channel chart', () => {
    const page = read('DashboardPage.jsx');
    assert.match(page, /stats\.grossSales/);
    assert.match(page, /dataKey="grossSales"/);
  });
});
