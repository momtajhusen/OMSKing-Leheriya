import test from 'node:test';
import assert from 'node:assert/strict';
import { isPaid, awaitsPayment } from './paymentStatus.js';

test('paid follows the API flag, a paid mark, or a Shopify checkout payment', () => {
  assert.equal(isPaid({ paid: true }), true);
  assert.equal(isPaid({ paymentStatus: 'paid' }), true);
  assert.equal(isPaid({ channel: 'Shopify', sourceOrderData: { financial_status: 'paid' } }), true);
  assert.equal(isPaid({ channel: 'Amazon', sourceOrderData: { financial_status: 'paid' } }), false);
  assert.equal(isPaid({ channel: 'Shopify', paymentMode: 'COD', paymentStatus: '' }), false);
  assert.equal(isPaid(null), false);
});

test('reconciliation waits only on delivered orders that are not paid on Shopify', () => {
  assert.equal(awaitsPayment({ status: 'Delivered', channel: 'Amazon' }), true);
  assert.equal(awaitsPayment({ status: 'Dispatched', channel: 'Amazon' }), false);
  assert.equal(awaitsPayment({ status: 'Delivered', channel: 'Shopify', paid: true }), false);
  assert.equal(awaitsPayment({ status: 'Delivered', channel: 'Shopify', paymentStatus: 'paid' }), false);
  assert.equal(awaitsPayment({ status: 'Delivered', channel: 'Shopify', paymentMode: 'COD' }), true);
});
