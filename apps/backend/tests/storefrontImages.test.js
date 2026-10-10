const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { firstImage, imageForSku, withImage, paintOrder } = require('../src/lib/catalogImages');
const { imagesFromStorefront } = require('../src/services/storefrontImages.service');

describe('product photos on orders', () => {
  it('keeps a real https photo and an uploaded file, and skips a placeholder host', () => {
    assert.equal(firstImage(['https://cdn.shopify.com/s/files/kurta.jpg']), 'https://cdn.shopify.com/s/files/kurta.jpg');
    assert.equal(firstImage(['/uploads/tenant/kurta.jpg']), '/uploads/tenant/kurta.jpg');
    assert.equal(firstImage(['https://www.example.com/luggage.png', 'https://cdn.shopify.com/real.jpg']), 'https://cdn.shopify.com/real.jpg');
    assert.equal(firstImage(['']), '');
  });

  it('paints the catalog photo onto the item, the sub-order, and the channel line', () => {
    const bySku = new Map([['leh-pbg3', 'https://cdn.shopify.com/s/files/pbg3.jpg']]);
    const painted = paintOrder({
      items: [{ sku: 'LEH-PBG3', name: 'LEH-PBG3', imageUrl: '' }],
      subOrders: [{ sku: 'LEH-PBG3', title: 'LEH-PBG3', imageUrl: '' }],
      channelLines: [{ sku: 'LEH-PBG3', imageUrl: '' }],
    }, bySku);
    assert.equal(painted.items[0].imageUrl, 'https://cdn.shopify.com/s/files/pbg3.jpg');
    assert.equal(painted.subOrders[0].imageUrl, 'https://cdn.shopify.com/s/files/pbg3.jpg');
    assert.equal(painted.channelLines[0].imageUrl, 'https://cdn.shopify.com/s/files/pbg3.jpg');
    assert.equal(withImage({ sku: 'missing', imageUrl: '' }, bySku).imageUrl, '');
    assert.equal(imageForSku(bySku, 'MLEH-PBG3'), 'https://cdn.shopify.com/s/files/pbg3.jpg');
    assert.equal(paintOrder({
      items: [{ sku: 'MLEH-KD-1814', imageUrl: '' }],
      subOrders: [],
      channelLines: [],
    }, new Map([['leh-kd-1814', 'https://cdn.shopify.com/s/files/kota.jpg']])).items[0].imageUrl, 'https://cdn.shopify.com/s/files/kota.jpg');
  });

  it('uses the variant photo when the storefront catalog has one', () => {
    const images = imagesFromStorefront([{
      images: [
        { id: 1, src: 'https://cdn.shopify.com/s/files/front.jpg' },
        { id: 2, src: 'https://cdn.shopify.com/s/files/side.jpg' },
      ],
      variants: [
        { sku: 'LEH-PBG3', image_id: 2 },
        { sku: '', image_id: 1 },
      ],
    }]);
    assert.equal(images.get('leh-pbg3'), 'https://cdn.shopify.com/s/files/side.jpg');
    assert.equal(images.has(''), false);
  });
});
