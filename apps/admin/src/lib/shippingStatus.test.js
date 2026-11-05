import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amazonLabelStep, courierChoice, courierOptionText, labelRequest, rateNote, pickupSlotText, shipmentStatus, splitLabelOrders, canHandOver, manifestFile, MANIFEST_COLUMNS,
} from './shippingStatus.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('an order with a label and AWB that is not picked up yet is Label generated; the other states stay', () => {
  const at = '2026-11-05T10:00:00Z';
  assert.equal(shipmentStatus({ channel: 'Amazon', status: 'Ready to Ship', awb: 'AMZ-1', labelGeneratedAt: at }), 'Label generated');
  assert.equal(shipmentStatus({ channel: 'Amazon', status: 'Ready to Ship' }), 'Label Pending');
  assert.equal(shipmentStatus({ channel: 'Amazon', status: 'Dispatched', awb: 'AMZ-1', labelGeneratedAt: at, pickedUpAt: at }), 'In Transit');
  assert.equal(shipmentStatus({ channel: 'Myntra', status: 'Packed', channelLines: [{ trackingNumber: 'MYN-1' }] }), 'Ready', 'tracking without an OMSKing label');
  assert.equal(shipmentStatus({ channel: 'Shopify', status: 'Delivered', awb: 'D1' }), 'Delivered');
});

test('a booked Shopify label (order set to Dispatched) waits in Label generated, moves to Ready on a manifest, then In Transit on the first scan', () => {
  const at = '2026-11-05T10:00:00Z';
  const booked = { channel: 'Shopify', status: 'Dispatched', awb: 'DL1', labelGeneratedAt: at };
  assert.equal(shipmentStatus(booked), 'Label generated');
  assert.equal(canHandOver({ ...booked, shipStatus: shipmentStatus(booked) }), true);
  const onManifest = { ...booked, handoverAt: at, manifestNo: 'MF-20261105-DELHIVERY-01' };
  assert.equal(shipmentStatus(onManifest), 'Ready');
  assert.equal(canHandOver({ ...onManifest, shipStatus: 'Ready' }), false);
  assert.equal(shipmentStatus({ ...onManifest, trackingScan: { status: 'Picked up' } }), 'In Transit');
  assert.equal(shipmentStatus({ channel: 'Shopify', status: 'Dispatched', awb: 'X1' }), 'In Transit', 'fulfilled outside OMSKing (no OMSKing label) stays In Transit');
});

test('handover manifest CSV has one numbered row per parcel with the courier, warehouse and COD', () => {
  const file = manifestFile({
    manifestNo: 'MF-20261105-DELHIVERY-01', day: '2026-11-05', courier: 'Delhivery', warehouseCode: 'WH-001',
    rows: [{ orderNo: 'SHP-1', channel: 'Shopify', awb: 'DL1', customer: 'Asha', city: 'Jaipur', pincode: '302001', paymentMode: 'COD', codAmount: 999, qty: 2, weightKg: 0.5 }],
  });
  assert.equal(file.name, 'MF-20261105-DELHIVERY-01.csv');
  assert.deepEqual(file.header, MANIFEST_COLUMNS);
  assert.deepEqual(file.rows[0].slice(0, 9), [1, 'MF-20261105-DELHIVERY-01', '2026-11-05', 'Delhivery', 'WH-001', 'SHP-1', '', 'Shopify', 'DL1']);
  assert.equal(file.rows[0][13], 999);
  const page = read('../pages/admin/ShippingPage.jsx');
  assert.match(page, /\/orders\/handover/);
  assert.match(page, /Move to Ready to hand over/);
  assert.match(page, /canHandOver\(row\)/);
});

test('the Easy Ship pickup slot reads as one short line', () => {
  const text = pickupSlotText({ easyShip: { slotStart: '2026-11-06T04:30:00Z', slotEnd: '2026-11-06T08:30:00Z', handover: 'PICKUP' } });
  assert.match(text, /^Pickup /);
  assert.match(text, /6 Nov/);
  assert.equal(pickupSlotText({ easyShip: null }), '');
  assert.match(pickupSlotText({ easyShip: { slotStart: '2026-11-06T04:30:00Z', handover: 'DROPOFF' } }), /^Drop-off /);
});

test('selected rows split into Shopify (label job) and Amazon (Easy Ship) labels', () => {
  const rows = [
    { id: 'S1', channel: 'Shopify', marketplace: false, shipStatus: 'Label Pending' },
    { id: 'A1', channel: 'Amazon', marketplace: true, shipStatus: 'Label Pending' },
    { id: 'A2', channel: 'Amazon', marketplace: true, shipStatus: 'Label generated' },
    { id: 'M1', channel: 'Myntra', marketplace: true, shipStatus: 'Label Pending' },
  ];
  assert.deepEqual(splitLabelOrders(rows, ['S1', 'A1', 'A2', 'M1']), { shopify: ['S1'], amazon: ['A1'] });
});

test('the Shipping page has the Label generated tab and the Amazon label, reprint, cancel and bulk actions', () => {
  const page = read('../pages/admin/ShippingPage.jsx');
  assert.match(page, /\{ id: 'Label generated', label: 'Label generated' \}/);
  assert.match(page, /Easy Ship label/);
  assert.match(page, /openAmazonLabel\(/);
  assert.match(page, /amazonLabels\(/);
  assert.match(page, /splitLabelOrders\(/);
  assert.match(page, /pickupSlotText\(row\)/);
  const store = read('../stores/orderStore.js');
  assert.match(store, /api\.post\('\/orders\/labels\/amazon', \{ orderIds/);
  const lib = read('./channelOrders.js');
  assert.match(lib, /\/orders\/\$\{encodeURIComponent\(order\.id\)\}\/amazon-label/);
});

test('an Amazon order offers Make Easy Ship label until it has one, then Amazon label; other channels get none', () => {
  assert.equal(amazonLabelStep({ channel: 'Amazon', status: 'Ready to Ship' }), 'make');
  assert.equal(amazonLabelStep({ channel: 'Amazon', status: 'Ready to Ship', awb: 'AWB1', labelGeneratedAt: '2026-11-05' }), 'print');
  assert.equal(amazonLabelStep({ channel: 'Amazon', status: 'Dispatched', awb: 'AWB1', labelGeneratedAt: '2026-11-05' }), 'print');
  assert.equal(amazonLabelStep({ channel: 'Amazon', status: 'Cancelled' }), null);
  assert.equal(amazonLabelStep({ channel: 'Amazon', status: 'Delivered' }), null);
  assert.equal(amazonLabelStep({ channel: 'Shopify', status: 'Ready to Ship' }), null);
});

test('the label courier defaults to Delhivery and only lists the company couriers; others need their AWB', () => {
  const couriers = [{ code: 'delhivery', name: 'Delhivery', api: true }, { code: 'bluedart', name: 'Bluedart', api: false }];
  assert.equal(courierChoice(couriers, '').picked.code, 'delhivery');
  assert.equal(courierChoice(couriers, 'bluedart').picked.name, 'Bluedart');
  assert.equal(courierChoice(couriers, 'ecom-express').picked.code, 'delhivery', 'a courier not enabled falls back to the default');
  assert.deepEqual(courierChoice([], 'bluedart').list.map((c) => c.code), ['delhivery']);
  assert.deepEqual(labelRequest(couriers[0], ''), { body: {} });
  assert.deepEqual(labelRequest(couriers[1], ' BD123 '), { body: { courier: 'bluedart', awb: 'BD123' } });
  assert.equal(labelRequest(couriers[1], ' ').error, 'Enter the Bluedart AWB');
});

test('each label courier shows its rate-card estimate before booking', () => {
  const delhivery = { code: 'delhivery', name: 'Delhivery', api: true, estimate: { chargeableKg: 0.75, slabs: 2, amount: 160 } };
  const xb = { code: 'xpressbees', name: 'Xpressbees', api: false, estimate: null };
  assert.equal(courierOptionText(delhivery), 'Delhivery · ₹160 (default)');
  assert.equal(courierOptionText(xb), 'Xpressbees · no rate (enter AWB)');
  assert.equal(rateNote(delhivery, { weightGrams: 500 }), 'Estimated ₹160 for 0.75 kg (2 × 0.5 kg). Rate card from Settings › Couriers; the courier bills the final amount.');
  assert.equal(rateNote(xb, { weightGrams: 500 }), 'No rate saved for Xpressbees. Add its ₹ per 0.5 kg in Settings › Couriers.');
  assert.equal(rateNote(delhivery, null), 'Package weight is missing, so no rate. Add item weights or the default package in Settings.');
});
