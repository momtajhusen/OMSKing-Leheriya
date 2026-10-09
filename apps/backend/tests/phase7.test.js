const test = require('node:test');
const assert = require('node:assert/strict');
const finance = require('../src/services/finance.service');

test('a delivered Shopify COD order stays partially paid until someone marks it', () => {
  const standing = finance.paymentStanding({
    channel: 'Shopify',
    status: 'Delivered',
    paymentMode: 'COD',
    paymentStatus: '',
  });
  assert.equal(standing.paid, false);
  assert.equal(standing.label, 'Partially paid');
  const paid = finance.paymentStanding({
    channel: 'Shopify',
    status: 'Delivered',
    paymentMode: 'COD',
    paymentStatus: 'paid',
  });
  assert.equal(paid.paid, true);
  assert.equal(paid.label, 'Paid');
});

test('one Amazon settlement line matches one Master Order', () => {
  const csv = [
    'order,gross,commission,shipping,fees,tcs,tds,refunds,net',
    'AMZ-1,1000,150,40,10,10,5,0,785',
  ].join('\n');
  const rows = finance.matchSettlement([
    { orderNo: 'AMZ-1', externalOrderId: '902-1', total: 1000 },
  ], csv, { source: 'amazon' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'matched');
  assert.equal(rows[0].orderNo, 'AMZ-1');
  assert.equal(rows[0].expected, 785);
});

test('a heavier courier bill is an exception and is not matched', () => {
  const csv = [
    'awb,charged_weight,declared_weight,cod,rto,ndr,surcharge,amount',
    'AWB-1,1.2,0.5,0,0,0,20,80',
    'AWB-2,0.5,0.5,30,0,0,0,50',
  ].join('\n');
  const rows = finance.matchCourierBill(csv);
  assert.equal(rows[0].status, 'exception');
  assert.match(rows[0].exception, /higher than the declared weight/);
  assert.equal(rows[1].status, 'matched');
  assert.equal(rows[0].cod + rows[0].rto + rows[0].ndr + rows[0].surcharge, 20);
});

test('a paid Shopify delivered order stays out of reconciliation and a return file marks Return Received', () => {
  const now = new Date('2026-10-09T00:00:00.000Z');
  const orders = [
    { orderNo: 'SHP-PAID', channel: 'Shopify', status: 'Delivered', paymentMode: 'Prepaid', paymentStatus: 'paid', createdAt: '2026-01-01' },
    { orderNo: 'SHP-PART', channel: 'Shopify', status: 'Delivered', paymentMode: 'Partially paid', paymentStatus: '', createdAt: '2026-01-01' },
    { orderNo: 'SHP-CANCEL', channel: 'Shopify', status: 'Cancelled', paymentMode: 'COD', createdAt: '2026-01-01' },
    { orderNo: 'SHP-NEW', channel: 'Shopify', status: 'Dispatched', paymentMode: 'Prepaid', paymentStatus: '', createdAt: '2026-10-01' },
    { orderNo: 'AMZ-1', channel: 'Amazon', status: 'Delivered', externalOrderId: '902-1', createdAt: '2026-08-01' },
  ];
  const queue = finance.reconciliationQueue(orders, { now });
  assert.equal(queue.some((row) => row.orderNo === 'SHP-PAID'), false);
  assert.equal(queue.some((row) => row.orderNo === 'SHP-CANCEL'), false);
  const partial = queue.find((row) => row.orderNo === 'SHP-PART');
  assert.equal(partial.paid, false);
  assert.equal(partial.paymentLabel, 'Partially paid');
  assert.equal(partial.flagged, true);
  const fresh = queue.find((row) => row.orderNo === 'SHP-NEW');
  assert.equal(fresh.paid, false);
  assert.equal(fresh.flagged, false);

  const payment = finance.matchSettlement(orders, [
    'order,gross,commission,shipping,fees,tcs,tds,refunds,net',
    'AMZ-1,1000,150,40,10,10,5,0,785',
  ].join('\n'), { source: 'amazon' });
  assert.equal(payment[0].label, 'Payment Received');
  assert.notEqual(payment[0].label, 'Return Received');

  const returns = finance.matchReturnFile(orders, [
    'order,qty',
    'AMZ-1,1',
    'MISSING,1',
  ].join('\n'));
  assert.equal(returns[0].orderNo, 'AMZ-1');
  assert.equal(returns[0].label, 'Return Received');
  assert.equal(returns[1].status, 'exception');
  assert.notEqual(returns[0].label, 'Payment Received');
});

test('Shopify invoice number is the channel order id and tax follows warehouse state', () => {
  const order = { channel: 'Shopify', orderNo: 'SHP-9', externalOrderId: '567890' };
  assert.equal(finance.invoiceNumber(order), '567890');
  assert.equal(finance.creditNoteNumber(order), 'CN-567890');
  const same = finance.lineTax({ price: 118, qty: 1, gst: 18 }, { warehouseState: 'Rajasthan', shipState: 'Rajasthan' });
  assert.equal(same.igst, 0);
  assert.ok(same.cgst > 0 && same.sgst > 0);
  const other = finance.lineTax({ price: 118, qty: 1, gst: 18 }, { warehouseState: 'Rajasthan', shipState: 'Maharashtra' });
  assert.equal(other.cgst, 0);
  assert.equal(other.sgst, 0);
  assert.ok(other.igst > 0);
});
