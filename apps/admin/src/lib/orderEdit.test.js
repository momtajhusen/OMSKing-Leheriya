import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditOrder, asksShopifyPush, orderEditForm } from './orderEdit.js';

test('an order can be edited until a label is generated or it ships', () => {
  assert.equal(canEditOrder({ status: 'New', channel: 'Shopify' }), true);
  assert.equal(canEditOrder({ status: 'Packed', channel: 'Manual' }), true);
  assert.equal(canEditOrder({ status: 'New', channel: 'Shopify', awb: 'AWB1' }), false);
  assert.equal(canEditOrder({ status: 'Dispatched', channel: 'Shopify' }), false);
  assert.equal(canEditOrder({ status: 'Delivered', channel: 'Shopify' }), false);
  assert.equal(canEditOrder({ status: 'Cancelled', channel: 'Shopify' }), false);
  assert.equal(canEditOrder({ status: 'New', channel: 'Amazon' }), false);
  assert.equal(canEditOrder({ status: 'New', channel: 'Myntra' }), false);
});

test('only orders that came from Shopify ask whether to push the edit there', () => {
  assert.equal(asksShopifyPush({ channel: 'Shopify', externalOrderId: '19033136136285' }), true);
  assert.equal(asksShopifyPush({ channel: 'Shopify', externalOrderId: '' }), false);
  assert.equal(asksShopifyPush({ channel: 'Manual', externalOrderId: '1' }), false);
});

test('the edit form starts from the saved customer and shipping details', () => {
  assert.deepEqual(
    orderEditForm({ customer: 'A', phone: '1', email: 'a@x.in', address: 'Lane', city: 'Hyderabad 500008', shipState: 'Telangana', total: 9 }),
    { customer: 'A', phone: '1', email: 'a@x.in', address: 'Lane', city: 'Hyderabad 500008', shipState: 'Telangana' },
  );
  assert.equal(orderEditForm({}).customer, '');
});
