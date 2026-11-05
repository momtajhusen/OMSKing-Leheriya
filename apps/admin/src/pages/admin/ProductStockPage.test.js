import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('the product name on Inventory opens that Master SKU product page, not the stock drawer', () => {
  const inventory = read('./InventoryPage.jsx');
  assert.match(inventory, /navigate\(`\/inventory\/sku\/\$\{item\.masterSkuId\}`\)/);
  const cell = inventory.slice(inventory.indexOf('navigate(`/inventory/sku/${item.masterSkuId}`)') - 300, inventory.indexOf('navigate(`/inventory/sku/${item.masterSkuId}`)'));
  assert.match(cell, /event\.stopPropagation\(\)/, 'clicking the name does not also open the drawer');
  assert.match(inventory, /navigate\(`\/inventory\/sku\/\$\{selected\.masterSkuId\}`\)/, 'the drawer links to the product page too');
});

test('the product page route is registered under the admin layout', () => {
  const router = read('../../router/index.jsx');
  assert.match(router, /const ProductStockPage = lazy\(\(\) => import\('\.\.\/pages\/admin\/ProductStockPage'\)\);/);
  assert.match(router, /path: '\/inventory\/sku\/:masterSkuId'/);
  assert.match(router, /<ProductStockPage \/>/);
});

test('the product page shows the OMSGuru-style details and an inventory block per warehouse', () => {
  const page = read('./ProductStockPage.jsx');
  assert.match(page, /api\.get\(`\/inventory\/sku\/\$\{masterSkuId\}`\)/);
  ['Sku Code', 'Name', 'Product Category', 'GST Tax', 'HSN Code', 'Date Created', 'Package (L×W×H cm)', 'Weight', 'Retail Price (MRP)', 'Selling Price', 'Last Purchase Price']
    .forEach((label) => assert.ok(page.includes(`'${label}'`), `${label} row`));
  assert.match(page, /Inventory detail for/);
  ['In Stock', 'Reserved', 'Available', 'Low-stock threshold', 'Manual Adjustments', 'Purchased Count', 'Shipped Count', 'Returned Count', 'Last Sold On']
    .forEach((label) => assert.ok(page.includes(`'${label}'`), `${label} row`));
  assert.match(page, /EmptyState/, 'a missing SKU shows an empty state');
});

test('the product page has a Channel Listings tab showing each listing with its linked inventory, Shopify Virtual last after a divider', () => {
  const page = read('./ProductStockPage.jsx');
  assert.match(page, /<TabsTrigger value="details">Details<\/TabsTrigger>/);
  assert.match(page, /<TabsTrigger value="listings">Channel Listings<\/TabsTrigger>/);
  assert.match(page, /data\.listings|listings = \[\]/, 'reads listings from the product API');
  ['Channel', 'Channel listing / SKU code / Name', 'Linked inventory', 'Status', 'Listed qty', 'Retail price', 'Selling price']
    .forEach((label) => assert.ok(page.includes(`>${label}</TableHead>`), `${label} column`));
  assert.match(page, /row\.group === 'shopify_virtual' && listings\[index - 1\]\?\.group !== 'shopify_virtual'/, 'a gap row before the first Shopify Virtual entry');
  assert.match(page, /Mapped On/);
  assert.match(page, /No channel listings/, 'empty state when nothing is linked');
});

test('the listing id opens the product on the marketplace website in a new tab', () => {
  const page = read('./ProductStockPage.jsx');
  assert.match(page, /row\.listingUrl \?/, 'link only when the API gives a listing URL');
  assert.match(page, /href=\{row\.listingUrl\}/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /rel="noopener noreferrer"/);
});
