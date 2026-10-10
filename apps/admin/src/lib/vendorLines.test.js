import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vendorLines, vendorReturnLines, vendorCatalog, vendorSaveAction, rowsWithSharedTracking } from './vendorLines.js';

test('vendor A sheet hides vendor B lines', () => {
  const orders = [{
    id: 'SHP-SPLIT',
    city: 'Surat',
    channel: 'Shopify',
    status: 'New',
    subOrders: [
      { id: 'SHP-SPLIT-1', assignedVendor: 'Vendor A', title: 'Kurta', sku: 'KURTA', vendorStatus: 'Pending Acceptance' },
      { id: 'SHP-SPLIT-2', assignedVendor: 'Vendor B', title: 'Kurta', sku: 'KURTA', vendorStatus: 'Pending Acceptance', vendorPhone: '9811100002' },
    ],
  }];
  const rows = vendorLines(orders, ['Vendor A']);
  assert.deepEqual(rows.map((row) => row.id), ['SHP-SPLIT-1']);
  assert.equal(JSON.stringify(rows).includes('Vendor B'), false);
  assert.equal(JSON.stringify(rows).includes('9811100002'), false);
  assert.deepEqual(vendorLines(orders, []), []);
});

test('vendor orders sheet has tracking, courier, dispatch date and delivery date', () => {
  const source = readFileSync(new URL('../pages/vendor/VendorOrdersPage.jsx', import.meta.url), 'utf8');
  assert.match(source, /Tracking ID/);
  assert.match(source, /Courier/);
  assert.match(source, /Dispatch Date/);
  assert.match(source, /Date of Delivery/);
  assert.match(source, /trackingNumber/);
  assert.match(source, /dispatchedDate/);
  assert.match(source, /deliveryDate/);
});

test('saving an accepted line dispatches it and refuses a blank tracking number', () => {
  const accepted = { status: 'Accepted', trackingNumber: 'AWB-1', courier: 'Delhivery', deliveryDate: '' };
  assert.equal(vendorSaveAction(accepted).action, 'dispatch');
  const missing = vendorSaveAction({ status: 'Ready to Dispatch', trackingNumber: '   ', courier: 'Delhivery' });
  assert.equal(missing.action, undefined);
  assert.match(missing.error, /Tracking number/);
  assert.equal(vendorSaveAction({ status: 'Dispatched', deliveryDate: '2026-10-10' }).action, 'deliver');
});

test('one tracking number is applied to every selected row', () => {
  const rows = [
    { id: 'A-1', trackingNumber: '', courier: '', status: 'Accepted' },
    { id: 'A-2', trackingNumber: 'OLD', courier: 'DTDC', status: 'Accepted' },
    { id: 'B-1', trackingNumber: '', courier: '', status: 'Accepted' },
  ];
  const applied = rowsWithSharedTracking(rows, ['A-1', 'A-2'], 'AWB-SHARED', 'Delhivery');
  assert.deepEqual(applied.picked.map((row) => row.id), ['A-1', 'A-2']);
  assert.deepEqual(applied.picked.map((row) => row.trackingNumber), ['AWB-SHARED', 'AWB-SHARED']);
  assert.equal(applied.picked.every((row) => row.courier === 'Delhivery'), true);
  const blank = rowsWithSharedTracking(rows, ['A-1'], '  ', 'Delhivery');
  assert.match(blank.error, /tracking/i);
});

test('vendor returns and products stay on that vendor', () => {
  const orders = [{
    id: 'ORD-RET',
    status: 'Delivered',
    reversePickup: { returnId: 'RET-1', reason: 'Size' },
    subOrders: [
      { id: 'A-1', assignedVendor: 'Vendor A', sku: 'SKU-A', title: 'A Saree', price: 10, vendorStatus: 'Delivered' },
      { id: 'B-1', assignedVendor: 'Vendor B', sku: 'SKU-B', title: 'B Shawl', price: 20, vendorPhone: '9811100002', vendorStatus: 'Delivered' },
    ],
  }, {
    id: 'ORD-CANCEL',
    status: 'Cancelled',
    subOrders: [
      { id: 'B-2', assignedVendor: 'Vendor B', sku: 'SKU-B2', title: 'B Dupatta', vendorStatus: 'Accepted' },
    ],
  }];
  const returns = vendorReturnLines(orders, ['Vendor A']);
  assert.deepEqual(returns.map((row) => row.id), ['A-1']);
  assert.equal(JSON.stringify(returns).includes('SKU-B'), false);
  assert.equal(JSON.stringify(returns).includes('9811100002'), false);
  assert.equal(JSON.stringify(returns).includes('B-2'), false);
  assert.deepEqual(vendorReturnLines(orders, []), []);

  const catalog = vendorCatalog(orders, ['Vendor A']);
  assert.deepEqual(catalog.map((row) => row.sku), ['SKU-A']);
  assert.equal(JSON.stringify(catalog).includes('SKU-B'), false);
  assert.deepEqual(vendorCatalog(orders, []), []);
});
