import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./OrdersPage.jsx', import.meta.url), 'utf8');

test('the order list shows the original channel order id with the OMS id under it', () => {
  assert.match(page, /order\.channelOrderNo \|\| order\.id/);
  assert.match(page, /order\.channelOrderNo && order\.channelOrderNo !== order\.id/);
});

test('orders have Shipway-style Pickup & Manifest, In Transit, Delivered and RTO tabs with counts', () => {
  const tabs = page.slice(page.indexOf('const STATUS_TABS'), page.indexOf('];', page.indexOf('const STATUS_TABS')));
  const order = ['Ready to Ship', 'Pickup & Manifest', 'In Transit', 'Delivered', 'RTO', 'Cancelled', 'all']
    .map((id) => tabs.indexOf(`id: '${id}'`));
  order.forEach((index) => assert.ok(index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(page, /counts\[tab\.id\]/);
});

test('Ready To Ship tab opens courier-wise manifests for the day, each with its own download', () => {
  assert.match(page, /api\.get\('\/orders\/manifests'/);
  assert.match(page, /activeTab === 'Ready to Ship' && can\(PERMISSIONS\.SHIPPING_GENERATE\)/);
  assert.match(page, /Courier manifests/);
  assert.match(page, /manifests\.map\(\(manifest\)/);
  assert.match(page, /downloadCsv\(`\$\{manifest\.manifestId\}\.csv`/);
  assert.match(page, /Download Manifest/);
});

test('Status, Payment and Date column headers have a filter option', () => {
  const header = page.slice(page.indexOf('<TableHeader>'), page.indexOf('</TableHeader>'));
  assert.match(header, /<StatusColumnFilter /);
  ['payment', 'date'].forEach((column) => {
    assert.match(header, new RegExp(`<ColumnFilter[^>]*column="${column}"`));
  });
  assert.match(page, /type="date"[^>]*value=\{dateFrom\}/);
  assert.match(page, /type="date"[^>]*value=\{dateTo\}/);
  const listCall = page.slice(page.indexOf('const loadOrders'), page.indexOf('const filteredOrders'));
  assert.match(listCall, /from: dateFrom \|\| undefined/);
  assert.match(listCall, /to: dateTo \|\| undefined/);
  assert.match(listCall, /tzOffset: new Date\(\)\.getTimezoneOffset\(\)/);
  assert.match(listCall, /dateFrom, dateTo/);
});

test('Amazon and Myntra orders show their SLA (dispatch-by) date in red', () => {
  const header = page.slice(page.indexOf('<TableHeader>'), page.indexOf('</TableHeader>'));
  assert.match(header, /SLA Date/);
  assert.match(page, /order\.slaDate \? \(\s*<span className="[^"]*text-red-600[^"]*"[^>]*>\{formatDateTime\(order\.slaDate\)\}<\/span>/);
});

test('orders have row checkboxes and a select-all box to pack or generate labels for many orders in one go', () => {
  const header = page.slice(page.indexOf('<TableHeader>'), page.indexOf('</TableHeader>'));
  assert.match(header, /type="checkbox"[^>]*aria-label="Select all orders on this page"/);
  assert.match(header, /togglePage\(prev, pageIds\)/);
  const body = page.slice(page.indexOf('<TableBody>'), page.indexOf('</TableBody>'));
  assert.match(body, /type="checkbox"[^>]*checked=\{selectedIds\.includes\(order\.id\)\}/);
  assert.match(body, /toggleId\(prev, order\.id\)/);
  assert.match(page, /packableIds\(filteredOrders, selectedIds\)/);
  assert.match(page, /setStatus\(id, 'Packed'\)/);
  assert.match(page, /labelableIds\(filteredOrders, selectedIds\)/);
  assert.match(page, /queueLabelJob\(ids\)/);
  assert.match(page, /can\(PERMISSIONS\.ORDERS_EDIT\) && \(\s*<Button[^>]*onClick=\{packSelected\}/);
  assert.match(page, /can\(PERMISSIONS\.SHIPPING_GENERATE\) && \(\s*<Button[^>]*onClick=\{labelSelected\}/);
  const listLoad = page.slice(page.indexOf('const loadOrders'), page.indexOf('const filteredOrders'));
  assert.match(listLoad, /setSelectedIds\(\[\]\)/);
});

test('Status header filter is a searchable multi-select list with Select all, clear and apply', () => {
  const header = page.slice(page.indexOf('<TableHeader>'), page.indexOf('</TableHeader>'));
  assert.match(header, /<StatusColumnFilter[^>]*value=\{activeTab\}/);
  const filter = page.slice(page.indexOf('function StatusColumnFilter'), page.indexOf('export default function OrdersPage'));
  assert.match(filter, /Filter By Status/);
  assert.match(filter, /placeholder="Search"/);
  assert.match(filter, /SELECT ALL/i);
  assert.match(filter, /type="checkbox"/);
  assert.match(filter, /statusOptions\(STATUS_TABS, search\)/);
  assert.match(filter, /statusParam\(draft, STATUS_TABS\)/);
  assert.match(filter, /aria-label="Clear status filter"/);
  assert.match(filter, /aria-label="Apply status filter"/);
});

test('orders get an Order ready badge and can be filtered by Order ready and vendor parcel status', () => {
  const listCall = page.slice(page.indexOf('const loadOrders'), page.indexOf('const filteredOrders'));
  assert.match(listCall, /ready: readyFilter/);
  assert.match(listCall, /parcel: parcelFilter/);
  const exportCall = page.slice(page.indexOf('const exportOrders'));
  assert.match(exportCall, /ready: readyFilter/);
  assert.match(exportCall, /parcel: parcelFilter/);
  assert.match(page, /\{order\.orderReady && \([\s\S]*?Order ready<\/Badge>/);
  assert.match(page, /<option value="ready">Order ready\{counts\.Ready != null/);
  assert.match(page, /<option value="not_ready">Not ready<\/option>/);
  assert.match(page, /<option value="Dispatched">Dispatched by vendor \(AWB\)<\/option>/);
  assert.match(page, /<option value="Delivered">Delivered by vendor<\/option>/);
  assert.match(page, /setReadyFilter\('all'\); setParcelFilter\('all'\);/);
});
