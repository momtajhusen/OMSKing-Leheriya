import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./ProductsPage.jsx', import.meta.url), 'utf8');

test('each Master SKU in the product list has a Print barcode button', () => {
  assert.match(page, /import \{ printBarcodeLabel \} from '\.\.\/\.\.\/lib\/barcodeLabel'/);
  const cell = page.slice(page.indexOf('productVariantRows(rows).map(({ key, product, variant: v }) =>'));
  const row = cell.slice(0, cell.indexOf('))}'));
  assert.match(row, /printBarcodeLabel\(\{ value: v\.barcode \|\| v\.code, name: product\.name \}\)/);
  assert.match(row, /aria-label=\{`Print barcode for \$\{v\.code\}`\}/);
});

test('product list shows one row per Master SKU, not variants clubbed per product', () => {
  assert.match(page, /import \{ productVariantRows, variantLabel[^}]*\} from '\.\.\/\.\.\/lib\/productRows'/);
  assert.match(page, /<TableRow key=\{key\}>/);
  assert.doesNotMatch(page, /\(product\.variants \|\| \[\]\)\.map\(/);
});

test('each Master SKU row shows that variant\'s own image', () => {
  assert.match(page, /import \{ productVariantRows, variantLabel, rowImage \} from '\.\.\/\.\.\/lib\/productRows'/);
  assert.match(page, /<ProductThumb [^>]*src=\{rowImage\(product, v\)\}/);
});

test('product list shows In Stock (Shopify Offline/Amazon/Myntra) and In Stock (Virtual) per Master SKU', () => {
  assert.match(page, /<TableHead[^>]*>In Stock \(Shopify Offline\/Amazon\/Myntra\)<\/TableHead>/);
  assert.match(page, /<TableHead[^>]*>In Stock \(Virtual\)<\/TableHead>/);
  assert.match(page, /\{v\?\.stock\?\.offline \?\? 0\}/);
  assert.match(page, /\{v\?\.stock\?\.virtual \?\? 0\}/);
});

test('changing page, searching or saving keeps the product list on screen instead of the full-page loader', () => {
  assert.match(page, /if \(loading && rows\.length === 0\) return <PageLoader label="Loading products\.\.\." \/>;/);
  assert.doesNotMatch(page, /if \(loading\) return <PageLoader/);
  assert.match(page, /<CardContent aria-busy=\{loading\} className=\{cn\('transition-opacity', loading && 'pointer-events-none opacity-60'\)\}>/);
});

test('product list has no Add variant action', () => {
  assert.doesNotMatch(page, /Add variant/);
  assert.doesNotMatch(page, /saveVariant|setVariantOpen/);
});
