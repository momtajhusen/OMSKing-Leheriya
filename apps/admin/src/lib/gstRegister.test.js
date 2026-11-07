import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  lineTax, stateKey, sellerStateOf, creditNoteDue, registerGroups, registerTotals, inPeriod,
} from './gstRegister.js';

const require = createRequire(import.meta.url);
const backend = require('../../../backend/src/services/finance.service.js');

test('register line tax equals the backend invoice maths to the paisa, including state aliases', () => {
  const cases = [
    [{ price: 999, qty: 1, gst: 5 }, 'Delhi', 'New Delhi'],
    [{ price: 1050, qty: 3, gst: 5 }, 'DL', 'Maharashtra'],
    [{ price: 2799, qty: 1, gst: 18 }, 'Orissa', 'Odisha'],
    [{ price: 333.33, qty: 2, gst: 12 }, 'Rajasthan', 'RJ'],
  ];
  cases.forEach(([item, warehouseState, shipState]) => {
    const mine = lineTax(item, { warehouseState, shipState });
    const theirs = backend.lineTax(item, { warehouseState, shipState });
    ['gross', 'taxable', 'cgst', 'sgst', 'igst', 'intraState'].forEach((key) => assert.equal(mine[key], theirs[key], `${key} for ${JSON.stringify(item)}`));
    assert.equal(stateKey(warehouseState) === stateKey(shipState), theirs.intraState);
  });
});

test('a line with no GST rate is flagged, not taxed at 0%, and is left out of the totals', () => {
  assert.equal(lineTax({ price: 2636, qty: 1, gst: 0 }).rateMissing, true);
  const groups = registerGroups([
    { id: 'A', status: 'Delivered', invoiceNo: 'I-1', invoiceGeneratedAt: '2026-10-05T10:00:00Z', shipState: 'Delhi', items: [{ price: 1050, qty: 1, gst: 5 }] },
    { id: 'B', status: 'Delivered', invoiceNo: 'I-2', invoiceGeneratedAt: '2026-10-06T10:00:00Z', shipState: 'Delhi', items: [{ price: 2636, qty: 1, gst: 0 }] },
  ], { warehouses: [{ code: 'WH-001', address: { state: 'Delhi' } }] });
  const totals = registerTotals(groups.invoiced);
  assert.equal(totals.rateMissing, 1);
  assert.equal(totals.taxable, 1000);
  assert.equal(totals.gst, 50);
});

test('seller state: the order warehouse, else WH-001, else the GSTIN state', () => {
  const warehouses = [{ code: 'WH-001', address: { state: 'Rajasthan' } }, { code: 'WH-002', address: { state: 'Delhi' } }];
  assert.equal(sellerStateOf({ warehouseCode: 'WH-002' }, warehouses), 'Delhi');
  assert.equal(sellerStateOf({}, warehouses), 'Rajasthan');
  assert.equal(sellerStateOf({}, [], '07AAQCP4784P1ZB'), 'Delhi');
});

test('credit notes only for OMS-invoiced orders that were reversed; marketplace and never-invoiced orders are not listed', () => {
  assert.equal(creditNoteDue({ channel: 'Shopify', status: 'Cancelled', invoiceGeneratedAt: '2026-10-01' }), true);
  assert.equal(creditNoteDue({ channel: 'Shopify', status: 'Cancelled' }), false, 'cancelled before any invoice');
  assert.equal(creditNoteDue({ channel: 'Myntra', source: 'channel_api', status: 'Cancelled', invoiceNo: 'I0727', invoiceGeneratedAt: '2026-10-01' }), false);
  assert.equal(creditNoteDue({ channel: 'Shopify', status: 'Delivered', invoiceGeneratedAt: '2026-10-01' }), false);
});

test('Shipped, no invoice leaves out Amazon and Myntra orders, which the marketplace invoices', () => {
  const groups = registerGroups([
    { id: 'S', channel: 'Shopify', source: 'channel_api', status: 'Dispatched', createdAt: '2026-10-01', items: [] },
    { id: 'M', channel: 'Myntra', source: 'channel_api', status: 'Dispatched', createdAt: '2026-10-01', items: [] },
  ]);
  assert.deepEqual(groups.pending.map((row) => row.order.id), ['S']);
});

test('period filter uses the IST month of the invoice date, swaps a reversed range, and rows sort by time', () => {
  const late = { id: 'L', invoiceGeneratedAt: '2026-10-31T20:00:00Z' };
  assert.equal(inPeriod(late, { from: '2026-11', to: '2026-11' }), true, '01:30 IST on 1 Nov is November');
  assert.equal(inPeriod(late, { from: '2026-12', to: '2026-11' }), true);
  const groups = registerGroups([
    { id: 'old', status: 'Delivered', invoiceNo: 'A', invoiceGeneratedAt: new Date('2026-10-02T00:00:00Z'), items: [] },
    { id: 'new', status: 'Delivered', invoiceNo: 'B', invoiceGeneratedAt: new Date('2026-10-20T00:00:00Z'), items: [] },
  ]);
  assert.deepEqual(groups.invoiced.map((row) => row.order.id), ['new', 'old']);
});

test('the GST page uses the shared register helpers, IST dates and a period filter', () => {
  const page = fs.readFileSync(new URL('../pages/admin/GstInvoicePage.jsx', import.meta.url), 'utf8');
  assert.match(page, /registerGroups\(orders, \{ warehouses, gstin, from, to \}\)/);
  assert.doesNotMatch(page, /slice\(0, 10\)/);
  assert.doesNotMatch(page, /cleanState/);
  assert.match(page, /type="month"/);
  assert.match(page, /Rate missing/);
});
