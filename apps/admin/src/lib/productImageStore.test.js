import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import useProductImageStore, { catalogPhoto, findProductImage, pageShowsProductPhotos } from './productImageStore.js';

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

test('settings does not download every order just to fill product photos', () => {
  assert.equal(pageShowsProductPhotos('/settings'), false);
  assert.equal(pageShowsProductPhotos('/settings/company'), false);
  assert.equal(pageShowsProductPhotos('/vendor/settings'), false);
  assert.equal(pageShowsProductPhotos('/orders'), true);
  assert.equal(pageShowsProductPhotos('/dashboard'), true);

  const source = fs.readFileSync(new URL('../components/catalog/ProductImageCatalog.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /hydrateFromApi/);
  assert.doesNotMatch(source, /['"]\/orders['"]/);
  assert.doesNotMatch(source, /['"]\/products['"]/);
  assert.doesNotMatch(source, /['"]\/master-skus['"]/);
});

test('remember stores many photos in one pass and keeps the first real photo', () => {
  useProductImageStore.setState({ byKey: { kept: 'https://cdn.shopify.com/s/files/kept.jpg' } });
  const pairs = [['kept', 'https://cdn.shopify.com/s/files/other.jpg']];
  for (let i = 0; i < 40; i += 1) pairs.push([`SKU-${i}`, `https://cdn.shopify.com/s/files/${i}.jpg`]);
  useProductImageStore.getState().remember(pairs);
  const map = useProductImageStore.getState().byKey;
  assert.equal(map.kept, 'https://cdn.shopify.com/s/files/kept.jpg');
  assert.equal(map['sku-0'], 'https://cdn.shopify.com/s/files/0.jpg');
  assert.equal(map['sku-39'], 'https://cdn.shopify.com/s/files/39.jpg');
  assert.equal(Object.keys(map).length, 41);
});
