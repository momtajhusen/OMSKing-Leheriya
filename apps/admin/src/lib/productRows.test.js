import test from 'node:test';
import assert from 'node:assert/strict';
import { productVariantRows, variantLabel, rowImage } from './productRows.js';

test('each Master SKU gets its own row instead of being clubbed under the product', () => {
  const rows = productVariantRows([
    { id: 'p1', name: 'Suit', variants: [{ id: 'v1', code: 'LEHE2773' }, { id: 'v2', code: 'LEHE2774' }] },
    { id: 'p2', name: 'Kurta', variants: [{ id: 'v3', code: 'LEH-KDS380' }] },
  ]);
  assert.deepEqual(rows.map((r) => r.variant.code), ['LEHE2773', 'LEHE2774', 'LEH-KDS380']);
  assert.deepEqual(rows.map((r) => r.key), ['v1', 'v2', 'v3']);
  assert.equal(rows[1].product.name, 'Suit');
});

test('a product without Master SKUs still shows one row', () => {
  const rows = productVariantRows([{ id: 'p1', name: 'Draft', variants: [] }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'p1');
  assert.equal(rows[0].variant, null);
});

test('variant label shows color and size', () => {
  assert.equal(variantLabel({ variantAttributes: { color: 'Red', size: 'M' } }), 'Red / M');
  assert.equal(variantLabel({ variantAttributes: {} }), '');
  assert.equal(variantLabel(null), '');
});

test('each variant row shows its own photo, falling back to the product photo', () => {
  const product = { images: ['https://cdn/suit.jpg'] };
  assert.equal(rowImage(product, { imageUrl: 'https://cdn/red.jpg' }), 'https://cdn/red.jpg');
  assert.equal(rowImage(product, { imageUrl: '' }), 'https://cdn/suit.jpg');
  assert.equal(rowImage(product, null), 'https://cdn/suit.jpg');
  assert.equal(rowImage({}, null), undefined);
});
