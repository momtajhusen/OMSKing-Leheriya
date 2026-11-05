import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./InventoryPage.jsx', import.meta.url), 'utf8');

test('the inventory page can queue the one-time Shopify opening stock import for settings managers', () => {
  assert.match(page, /api\.post\('\/integrations\/jobs', \{ channel: 'shopify', jobType: 'stock_import' \}\)/);
  assert.match(page, /can\(PERMISSIONS\.SETTINGS_MANAGE\) && omsMaster/);
  assert.match(page, /Import stock from Shopify/);
});

test('opening the page or changing tab does not download the whole Master SKU catalogue', () => {
  const load = page.slice(page.indexOf('const load = async'), page.indexOf('useEffect(() => { load(); }'));
  assert.ok(load.length > 0, 'load() is found');
  assert.doesNotMatch(load, /master-skus/, 'load() runs on every tab, page and warehouse change');
});

test('changing tab, page or warehouse does not re-download the warehouse list', () => {
  const load = page.slice(page.indexOf('const load = async'), page.indexOf('useEffect(() => { load(); }'));
  assert.doesNotMatch(load, /api\.get\('\/warehouses'\)/);
  assert.match(page, /useEffect\(\(\) => \{ loadWarehouses\(\); \}, \[\]\);/);
  const loadWarehouses = page.slice(page.indexOf('const loadWarehouses = async'), page.indexOf('const load = async'));
  assert.match(loadWarehouses, /api\.get\('\/warehouses'\)/);
});

test('refreshing the stock list keeps the current rows on screen, dimmed, while it loads', () => {
  assert.match(page, /<CardContent aria-busy=\{loading\} className=\{cn\('transition-opacity', loading && 'pointer-events-none opacity-60'\)\}>/);
});

test('the Stock in dialog loads the Master SKU list when it opens', () => {
  assert.match(page, /useEffect\(\(\) => \{\s*if \(inOpen && !mastersLoaded\) loadMasters\(\);\s*\}, \[inOpen\]\);/);
  const loadMasters = page.slice(page.indexOf('const loadMasters = async'), page.indexOf('const load = async'));
  assert.match(loadMasters, /api\.get\('\/master-skus'\)/);
  assert.match(page, /Loading Master SKUs/);
});

test('the Stock by SKU column shows the Shopify SKU, with the Master SKU code under it', () => {
  const stockTable = page.slice(page.indexOf('<TableHead>Visible on</TableHead>') - 400, page.indexOf('>{item.productName}</button>'));
  assert.match(stockTable, /\{item\.shopifySku \|\| item\.sku\}/);
  assert.match(stockTable, /item\.shopifySku && item\.shopifySku !== item\.sku/);
  assert.match(stockTable, /Master \{item\.sku\}/);
});

test('stock can be sorted by qty on the server, so the most stocked SKUs come first across pages', () => {
  const load = page.slice(page.indexOf('const load = async'), page.indexOf('useEffect(() => { load(); }'));
  assert.match(load, /api\.get\('\/inventory', \{ params: \{[^}]*sort: sort \|\| undefined/);
  assert.match(page, /useEffect\(\(\) => \{ load\(\); \}, \[warehouseId, tab, sort, page, ledgerPage\]\);/);
  assert.match(page, /<option value="qty_desc">Qty: high to low<\/option>/);
  assert.match(page, /<option value="qty_asc">Qty: low to high<\/option>/);
});

test('the page explains what ATS means on the subtitle and on each channel ATS column', () => {
  assert.match(page, /ATS = available to sell on that channel/);
  assert.match(page, /<TableHead key=\{channel\.id\} title=\{`Available to sell on \$\{orderChannelLabel\(channel\)\}`\}>/);
});
