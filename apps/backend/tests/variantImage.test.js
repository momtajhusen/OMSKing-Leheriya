const test = require('node:test');
const assert = require('node:assert/strict');
const { mapMaster, mapMapping } = require('../src/services/catalogMapping.service');

const PRODUCT_IMG = 'https://cdn.shopify.com/product-first.jpg';
const SHOPIFY_VARIANT_IMG = 'https://cdn.shopify.com/design-2.jpg';
const MYNTRA_VARIANT_IMG = 'https://assets.myntassets.com/design-2.jpg';

const product = { _id: 'p1', name: 'Banarasi Silk Suit', images: [PRODUCT_IMG] };

test('master SKU list shows the variant photo, not the first product image', () => {
  const master = { _id: 'm2', code: 'LEH-JJ60', name: 'Banarasi Silk Suit / Design2', productId: product };
  const row = mapMaster(master, [
    { _id: 'x1', channel: 'myntra', channelSkuCode: 'MLEH-JJ60', imageUrl: MYNTRA_VARIANT_IMG },
    { _id: 'x2', channel: 'shopify', channelSkuCode: 'LEH-JJ60', imageUrl: SHOPIFY_VARIANT_IMG },
  ]);
  assert.equal(row.imageUrl, SHOPIFY_VARIANT_IMG);
});

test('master SKU without a variant photo falls back to the product image', () => {
  const master = { _id: 'm1', code: 'LEH-JJ61', name: 'Banarasi Silk Suit / Design1', productId: product };
  assert.equal(mapMaster(master, [{ _id: 'x3', channel: 'shopify', channelSkuCode: 'LEH-JJ61', imageUrl: '' }]).imageUrl, PRODUCT_IMG);
  assert.equal(mapMaster(master).imageUrl, PRODUCT_IMG);
});

test('SKU mapping row shows its own listing photo before the product image', () => {
  const master = { _id: 'm2', code: 'LEH-JJ60', name: 'Banarasi Silk Suit / Design2', productId: product };
  const withPhoto = mapMapping({ _id: 'x2', channel: 'shopify', channelSkuCode: 'LEH-JJ60', masterSkuId: master, imageUrl: SHOPIFY_VARIANT_IMG });
  assert.equal(withPhoto.imageUrl, SHOPIFY_VARIANT_IMG);
  const noPhoto = mapMapping({ _id: 'x4', channel: 'shopify', channelSkuCode: 'LEH-JJ60', masterSkuId: master, imageUrl: '' });
  assert.equal(noPhoto.imageUrl, PRODUCT_IMG);
});
