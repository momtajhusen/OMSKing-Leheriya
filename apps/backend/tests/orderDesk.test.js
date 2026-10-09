const test = require('node:test');
const assert = require('node:assert/strict');
const { applyDeskRules } = require('../src/services/orderDesk.service');

function order(overrides) {
  return {
    id: 'A',
    orderNo: 'A',
    status: 'New',
    channel: 'Myntra',
    paymentMode: 'COD',
    createdAt: '2026-01-01',
    items: [{ sku: 'S', qty: 1, masterSkuId: 'sku1' }],
    subOrders: [{ id: 'A-1', sku: 'S', qty: 1 }],
    ...overrides,
  };
}

test('oldest order takes WH-001 and the next open order goes to a vendor', () => {
  const rows = applyDeskRules([
    order({ id: 'NEW', createdAt: '2026-01-02' }),
    order({ id: 'OLD', orderNo: 'OLD', createdAt: '2026-01-01', paymentMode: 'Partially Paid', subOrders: [{ id: 'OLD-1', sku: 'S', qty: 1 }] }),
  ], { physical: new Map([['sku1', 1]]), virtual: new Map() });
  const older = rows.find((row) => row.id === 'OLD');
  const newer = rows.find((row) => row.id === 'NEW');
  assert.equal(older.fulfilmentSource, 'Offline');
  assert.equal(older.paymentMode, 'COD');
  assert.equal(older.paymentDetail, 'Partially paid');
  assert.equal(newer.fulfilmentSource, 'Virtual');
  assert.match(newer.routeNote, /Out of stock/);
  assert.equal(newer.subOrders[0].fulfilmentSource, 'Virtual');
});

test('qty above WH-001 stock splits pack and vendor on one master order', () => {
  const [row] = applyDeskRules([
    order({
      items: [{ sku: 'S', qty: 2, masterSkuId: 'sku1' }],
      subOrders: [{ id: 'A-1', sku: 'S', qty: 1 }, { id: 'A-2', sku: 'S', qty: 1 }],
    }),
  ], { physical: new Map([['sku1', 1]]), virtual: new Map() });
  assert.equal(row.fulfilmentSource, 'Mixed');
  assert.equal(row.subOrders[0].fulfilmentSource, 'Offline');
  assert.equal(row.subOrders[1].fulfilmentSource, 'Virtual');
});

test('unmapped open line is unfulfillable and shopify virtual stock is a vendor line', () => {
  const [unmapped, virtual] = applyDeskRules([
    order({ id: 'U', items: [{ sku: 'X', qty: 1, masterSkuId: '' }], subOrders: [] }),
    order({ id: 'V', channel: 'Shopify', paymentMode: 'cash on delivery', items: [{ sku: 'S', qty: 1, masterSkuId: 'sku1' }], subOrders: [{ id: 'V-1', sku: 'S', qty: 1 }] }),
  ], { physical: new Map(), virtual: new Map([['sku1', 4]]) });
  assert.equal(unmapped.status, 'Unfulfillable');
  assert.equal(unmapped.mappingFailed, true);
  assert.equal(virtual.fulfilmentSource, 'Virtual');
  assert.equal(virtual.paymentMode, 'COD');
  assert.match(virtual.routeNote, /Virtual/);
});

test('delivered orders keep the stored fulfilment source', () => {
  const [row] = applyDeskRules([
    order({ status: 'Delivered', fulfilmentSource: 'Offline', paymentMode: 'Prepaid' }),
  ], { physical: new Map(), virtual: new Map() });
  assert.equal(row.status, 'Delivered');
  assert.equal(row.fulfilmentSource, 'Offline');
  assert.equal(row.paymentMode, 'Prepaid');
});
