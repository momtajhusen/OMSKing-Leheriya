import test from 'node:test';
import assert from 'node:assert/strict';
import useProductImageStore, { catalogPhoto, findProductImage } from './productImageStore.js';

test('a placeholder never replaces a real product photo', () => {
  assert.equal(catalogPhoto('https://picsum.photos/200'), '');
  assert.equal(catalogPhoto('https://cdn.shopify.com/s/files/bandh.jpg'), 'https://cdn.shopify.com/s/files/bandh.jpg');
  assert.equal(catalogPhoto('/uploads/tenant/bandh.jpg'), '/uploads/tenant/bandh.jpg');

  useProductImageStore.setState({ byKey: {} });
  useProductImageStore.getState().remember([
    ['BANDH-1', 'https://picsum.photos/200'],
    ['BANDH-1', 'https://cdn.shopify.com/s/files/bandh.jpg'],
  ]);
  assert.equal(findProductImage(useProductImageStore.getState().byKey, 'BANDH-1'), 'https://cdn.shopify.com/s/files/bandh.jpg');

  useProductImageStore.getState().remember([['BANDH-1', 'https://placehold.co/200']]);
  assert.equal(findProductImage(useProductImageStore.getState().byKey, 'bandh-1'), 'https://cdn.shopify.com/s/files/bandh.jpg');
});
