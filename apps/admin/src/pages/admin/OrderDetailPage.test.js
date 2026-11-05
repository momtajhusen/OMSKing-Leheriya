import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { vendorPick, mappedVendor, pendingAssigns } from '../../lib/vendorLines.js';

const page = fs.readFileSync(new URL('./OrderDetailPage.jsx', import.meta.url), 'utf8');

test('an unassigned sub-order shows the vendor its Shopify vendor is mapped to, ready to Assign', () => {
  const vendors = [
    { name: 'Jaipur Prints', shopifyVendors: ['Leheriya Jaipur', 'JP Studio'] },
    { name: 'Surat Weaves', shopifyVendors: [] },
  ];
  assert.equal(mappedVendor(vendors, 'jp studio'), 'Jaipur Prints');
  assert.equal(mappedVendor(vendors, 'Surat Weaves'), 'Surat Weaves', 'a vendor with the same name counts as mapped');
  assert.equal(mappedVendor(vendors, 'Unknown'), '');
  assert.equal(mappedVendor(vendors, ''), '');

  const sub = { id: 'SHP-9-1', assignedVendor: '' };
  assert.deepEqual(vendorPick({}, sub, 'Jaipur Prints'), { value: 'Jaipur Prints', changed: true });
  assert.deepEqual(vendorPick({ 'SHP-9-1': 'Surat Weaves' }, sub, 'Jaipur Prints'), { value: 'Surat Weaves', changed: true });
  const saved = { id: 'SHP-9-2', assignedVendor: 'Surat Weaves' };
  assert.deepEqual(vendorPick({}, saved, 'Jaipur Prints'), { value: 'Surat Weaves', changed: false }, 'a saved vendor wins over the mapping');

  const table = page.slice(page.indexOf('Fulfilment & vendor tracking'));
  assert.match(table, /vendorPick\(picks, sub, mappedOf\(sub\)\)\.value/);
  assert.match(table, /disabled=\{!vendorPick\(picks, sub, mappedOf\(sub\)\)\.changed/);
  assert.match(page, /const mappedOf = \(sub\) => mappedVendor\(vendors, shopifyVendorOf\(sub\)\)/);
  assert.match(page, /vendorPick\(picks, sub, mappedOf\(sub\)\);/, 'Assign saves the mapped vendor');
});

test('Vendors form edits the Shopify vendor names mapped to a vendor', () => {
  const vendorsPage = fs.readFileSync(new URL('./VendorsPage.jsx', import.meta.url), 'utf8');
  assert.match(vendorsPage, /Shopify vendor names/);
  assert.match(vendorsPage, /shopifyVendors: \(vendor\.shopifyVendors \|\| \[\]\)\.join\(', '\)/);
  const store = fs.readFileSync(new URL('../../stores/vendorStore.js', import.meta.url), 'utf8');
  assert.match(store, /shopifyVendors: String\(payload\.shopifyVendors \|\| ''\)\.split\(','\)/);
});

test('picking a vendor only selects it; Assign is ready once the pick differs from the saved vendor', () => {
  const sub = { id: 'SHP-1-1', assignedVendor: '' };
  assert.deepEqual(vendorPick({}, sub), { value: '', changed: false });
  assert.deepEqual(vendorPick({ 'SHP-1-1': 'ABL' }, sub), { value: 'ABL', changed: true });
  const saved = { id: 'SHP-1-2', assignedVendor: 'ABL' };
  assert.deepEqual(vendorPick({ 'SHP-1-2': 'ABL' }, saved), { value: 'ABL', changed: false });
  assert.deepEqual(vendorPick({ 'SHP-1-2': '' }, saved), { value: '', changed: true });
});

test('the sub-order vendor dropdown waits for the Assign button at the far right of the row', () => {
  const table = page.slice(page.indexOf('Fulfilment & vendor tracking'));
  const select = table.slice(table.indexOf('<Select'), table.indexOf('</Select>'));
  assert.doesNotMatch(select, /assignSubOrder/, 'choosing a vendor does not assign it straight away');
  assert.match(select, /setPicks/);
  const lastCell = table.slice(table.lastIndexOf('<TableCell'));
  assert.match(lastCell, />\s*Assign\s*</, 'Assign sits in the last column');
  assert.match(lastCell, /assignPicked\(sub\)/);
  assert.match(lastCell, /disabled=\{!vendorPick\(picks, sub, mappedOf\(sub\)\)\.changed/);
});

test('Assign all saves every shown vendor (Shopify-mapped or picked) of the order in one go', () => {
  const subs = [
    { id: 'SHP-7-1', assignedVendor: '' },
    { id: 'SHP-7-2', assignedVendor: '' },
    { id: 'SHP-7-3', assignedVendor: 'Surat Weaves' },
    { id: 'SHP-7-4', assignedVendor: '' },
  ];
  const mapped = { 'SHP-7-1': 'Jaipur Prints', 'SHP-7-2': '', 'SHP-7-3': 'Jaipur Prints', 'SHP-7-4': 'Jaipur Prints' };
  assert.deepEqual(
    pendingAssigns(subs, { 'SHP-7-2': 'Surat Weaves', 'SHP-7-4': '' }, (sub) => mapped[sub.id]),
    [{ sub: subs[0], name: 'Jaipur Prints' }, { sub: subs[1], name: 'Surat Weaves' }],
    'unchanged rows and rows left Unassigned are skipped',
  );

  const card = page.slice(page.indexOf('Fulfilment & vendor tracking'), page.indexOf('<Table>', page.indexOf('Fulfilment & vendor tracking')));
  assert.match(card, />\s*Assign all\s*</, 'Assign all sits on the vendor tracking card');
  assert.match(card, /onClick=\{assignAll\}/);
  assert.match(card, /disabled=\{!pendingAssigns\(order\.subOrders, picks, mappedOf\)\.length/);
  assert.match(page, /const pending = pendingAssigns\(order\.subOrders, picks, mappedOf\);/);
  assert.match(page, /await assignSubOrder\(order\.id, sub\.id, \{ assignedVendor: name \}\)/);
});

test('Order items has a Barcode column right after SKU', () => {
  const table = page.slice(page.indexOf('<CardTitle>Order items</CardTitle>'), page.indexOf('</Table>', page.indexOf('<CardTitle>Order items</CardTitle>')));
  assert.match(table, /<TableHead>SKU<\/TableHead>\s*<TableHead>Barcode<\/TableHead>\s*<TableHead>Qty<\/TableHead>/);
  assert.match(table, /\{item\.sku\}<\/TableCell>\s*<TableCell[^>]*>(?:(?!<\/TableCell>)[\s\S])*<BarcodeImage value=\{item\.barcode \|\| item\.sku\} \/>/);
});

test('each order item has a Print barcode button in its Barcode cell', () => {
  assert.match(page, /import \{ barcodeBars, printBarcodeLabel \} from '\.\.\/\.\.\/lib\/barcodeLabel'/);
  const table = page.slice(page.indexOf('<CardTitle>Order items</CardTitle>'), page.indexOf('</Table>', page.indexOf('<CardTitle>Order items</CardTitle>')));
  const cell = table.slice(table.indexOf('{item.sku}</TableCell>') + '{item.sku}</TableCell>'.length);
  const barcodeCell = cell.slice(0, cell.indexOf('</TableCell>'));
  assert.match(barcodeCell, /printBarcodeLabel\(\{ value: item\.barcode \|\| item\.sku, name: item\.name \}\)/);
  assert.match(barcodeCell, /aria-label=\{`Print barcode for \$\{item\.sku\}`\}/);
});

test('Edit order is shown to editors and a Shopify order asks before pushing the edit to Shopify', () => {
  assert.match(page, /can\(PERMISSIONS\.ORDERS_EDIT\) && canEditOrder\(order\)/);
  assert.match(page, />\s*Edit order\s*</);
  assert.match(page, /Push this change to Shopify\?/);
  assert.match(page, /saveEdit\(false\)/, 'No keeps the edit in OMS only');
  assert.match(page, /saveEdit\(true\)/, 'Yes pushes it to Shopify');
  assert.match(page, /asksShopifyPush\(order\)/);
  assert.match(page, /editOrder\(order\.id, \{ \.\.\.editForm, pushToShopify \}\)/);
});

test('an unmapped order line can be mapped to a Master SKU right inside the order', () => {
  const items = page.slice(page.indexOf('Order items'), page.indexOf('Fulfilment & vendor tracking'));
  assert.match(items, /item\.mappingFailed/, 'the items table knows which line is unmapped');
  assert.match(items, /can\(PERMISSIONS\.CATALOG_EDIT\)/, 'only catalog editors see the map option');
  assert.match(items, />\s*Map SKU\s*</);
  assert.match(page, /mapItemSku\(order\.id, \{ sku: mapItem\.sku, masterSkuCode: mapCode \}\)/);
  assert.match(page, /\/master-skus/, 'Master SKU suggestions come from the catalog');
  const store = fs.readFileSync(new URL('../../stores/orderStore.js', import.meta.url), 'utf8');
  assert.match(store, /\/map-sku`/);
});

test('vendors are assigned only in Fulfilment & vendor tracking, not again on top in Order items', () => {
  const items = page.slice(page.indexOf('Order items'), page.indexOf('Fulfilment & vendor tracking'));
  assert.doesNotMatch(items, /<Select/, 'no vendor dropdown in Order items');
  assert.doesNotMatch(items, /Assign vendor/);
  assert.doesNotMatch(items, /assignItem/);
  assert.match(items, /Shopify vendor: <span className="font-medium text-foreground">\{item\.vendor \|\| '—'\}<\/span>/, 'the Shopify vendor name stays under the product');
});

test('Fulfilment & vendor tracking shows the Shopify vendor in its own column right before Vendor', () => {
  const table = page.slice(page.indexOf('Fulfilment & vendor tracking'));
  assert.match(table, /<TableHead>Item<\/TableHead>\s*<TableHead>Shopify vendor<\/TableHead>\s*<TableHead>Vendor<\/TableHead>/);
  const row = table.slice(table.indexOf('order.subOrders.map'));
  const itemCellEnd = row.indexOf('</TableCell>', row.indexOf('{sub.sku} · qty {sub.qty}'));
  const nextCell = row.slice(itemCellEnd + '</TableCell>'.length, row.indexOf('</TableCell>', itemCellEnd + 1));
  assert.match(nextCell, /shopifyVendorOf\(sub\)/, 'the cell after Item shows the Shopify vendor');
  assert.match(page, /const shopifyVendorOf = \(sub\) => order\.items\.find\(\(item\) => item\.sku === sub\.sku\)\?\.vendor \|\| order\.shopifyVendor \|\| ''/);
});

test('Generate Invoice asks for an optional customer GSTIN for a B2B sale and sends it with the invoice', () => {
  assert.match(page, /onClick=\{openInvoice\}/);
  assert.match(page, /Customer GSTIN \(B2B, optional\)/);
  assert.match(page, /generateInvoice\(order\.id, \{ customerGstin \}\)/);
  const store = fs.readFileSync(new URL('../../stores/orderStore.js', import.meta.url), 'utf8');
  assert.match(store, /\{ kind, email, \.\.\.\(customerGstin === undefined \? \{\} : \{ customerGstin \}\) \}/);
});

test('the order shows the customer history and a High / Medium / Low risk tag from the customer-history API', () => {
  assert.match(page, /\/customer-history`/);
  const head = page.slice(page.indexOf('<h1'), page.indexOf('Customer & address'));
  assert.match(head, /Last order status/);
  assert.match(head, /Past orders/);
  assert.match(head, /Delivered orders/);
  assert.match(head, /Cancelled orders/);
  const customer = page.slice(page.indexOf('Customer & address'), page.indexOf('Shipping address'));
  assert.match(customer, /history\.risk/);
  assert.match(page, /High: 'text-red-600'/);
  assert.match(page, /Medium: 'text-orange-500'/);
  assert.match(page, /Low: 'text-green-600'/);
});

test('when the company has no active vendors the row says so and links to the Vendors page', () => {
  assert.match(page, /No vendors yet/);
  assert.match(page, /to="\/vendors"/);
});

test('order items show the barcode itself in the Barcode column, next to the print button', () => {
  const src = fs.readFileSync(new URL('./OrderDetailPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /<BarcodeImage value=\{item\.barcode \|\| item\.sku\}/);
  assert.match(src, /barcodeBars\(/);
});

test('Customer & address has an Order notes field that editors can save', () => {
  const customer = page.slice(page.indexOf('<CardTitle>Customer & address</CardTitle>'), page.indexOf('<CardTitle>Shipment</CardTitle>'));
  assert.match(customer, /Order notes/);
  assert.match(customer, /<textarea/);
  assert.match(customer, /Dispatch after 10 Nov/, 'the placeholder shows an example note');
  assert.match(customer, /can\(PERMISSIONS\.ORDERS_EDIT\)/, 'only editors can change the notes');
  assert.match(customer, /order\.notes/);
  assert.match(page, /saveOrderNotes\(order\.id, notesDraft\)/);
  const store = fs.readFileSync(new URL('../../stores/orderStore.js', import.meta.url), 'utf8');
  assert.match(store, /saveOrderNotes: async \(id, notes\) =>/);
  assert.match(store, /api\.patch\(`\/orders\/\$\{encodeURIComponent\(orderId\)\}\/notes`, \{ notes \}\)/);
});

test('Order items shows each line weight and L × B × H with where it comes from', async () => {
  const { packageWeight, packageSize, PACKAGE_SOURCE, packageForm } = await import('../../lib/itemPackage.js');
  assert.equal(packageWeight({ weightKg: 0.5 }), '0.5 kg');
  assert.equal(packageWeight({ weightKg: 0 }), '—');
  assert.equal(packageSize({ lengthCm: 30, breadthCm: 25, heightCm: 5 }), '30 × 25 × 5 cm');
  assert.equal(packageSize(null), '—');
  assert.equal(PACKAGE_SOURCE.default, 'Default');
  assert.deepEqual(packageForm({ weightKg: 0.5, lengthCm: 30, breadthCm: 25, heightCm: 5, source: 'default' }), { weightKg: '0.5', lengthCm: '30', breadthCm: '25', heightCm: '5' });
  const items = page.slice(page.indexOf('<CardTitle>Order items</CardTitle>'), page.indexOf('Fulfilment & vendor tracking'));
  assert.match(items, /<TableHead>Weight<\/TableHead>/);
  assert.match(items, /<TableHead>Size \(L × B × H\)<\/TableHead>/);
  assert.match(items, /packageWeight\(item\.package\)/);
  assert.match(items, /packageSize\(item\.package\)/);
  assert.match(items, /PACKAGE_SOURCE\[item\.package\.source\]/);
});

test('editors change one line weight and L/B/H from Order items until the label is generated', () => {
  const items = page.slice(page.indexOf('<CardTitle>Order items</CardTitle>'), page.indexOf('Fulfilment & vendor tracking'));
  assert.match(items, /can\(PERMISSIONS\.ORDERS_EDIT\) && !order\.awb/);
  assert.match(items, /openPack\(item, index\)/);
  assert.match(page, /saveItemPackage\(order\.id, packItem\.index, packForm\)/);
  for (const label of ['Weight \\(kg\\)', 'Length \\(cm\\)', 'Breadth \\(cm\\)', 'Height \\(cm\\)']) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /fetchOrder\(masterId\)/, 'an order from the list is fetched once to get the line packages');
  const store = fs.readFileSync(new URL('../../stores/orderStore.js', import.meta.url), 'utf8');
  assert.match(store, /saveItemPackage: async \(id, index, body\) =>/);
  assert.match(store, /api\.patch\(`\/orders\/\$\{encodeURIComponent\(orderId\)\}\/items\/\$\{index\}\/package`, body\)/);
});

test('an order missing from the loaded list is fetched by id before showing Order not found', () => {
  const store = fs.readFileSync(new URL('../../stores/orderStore.js', import.meta.url), 'utf8');
  assert.match(store, /fetchOrder: async \(id\) =>/);
  assert.match(store, /api\.get\(`\/orders\/\$\{encodeURIComponent\(id\)\}`\)/);
  assert.match(page, /const fetchOrder = useOrderStore\(\(s\) => s\.fetchOrder\)/);
  assert.match(page, /if \(!loaded \|\| order \|\| lookup\.id === orderId\) return;/);
  assert.match(page, /fetchOrder\(orderId\)\.finally/);
  assert.match(page, /const lookedUp = lookup\.id === orderId && lookup\.done;/);
  assert.match(page, /if \(!order && \(!loaded \|\| !lookedUp\)\) return <div[^>]*>Loading order…<\/div>;/);
});

test('vendor tracking shows assignment message status, offline stock, and takes a tracking ID and delivery date', () => {
  assert.match(page, /sub\.assignNotice === 'sent' \? 'Assigned' : 'Message failed'/);
  assert.match(page, /Offline stock: \{sub\.offlineQty \?\? 0\}/);
  assert.match(page, /order\.orderReady && <Badge[^>]*>Order ready<\/Badge>/);
  assert.match(page, /deliveryDate: sub\.deliveredDate \|\| todayIso\(\)/);
  assert.match(page, /vendorSaveAction\(\{ status: tracking\.status, trackingNumber: tracking\.trackingNumber, courier: tracking\.courier, deliveryDate: tracking\.deliveryDate \}\)/);
  assert.match(page, /vendorUpdate\(order\.id, tracking\.subId, \{/);
  assert.match(page, /deliveredDate: tracking\.deliveryDate/);
  assert.match(page, /title="Tracking & delivery"/);
});

test('the vendor tracking table has a Date of delivery column that opens the tracking box (today by default) to edit it', () => {
  const page = fs.readFileSync(new URL('./OrderDetailPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /<TableHead>Dispatch<\/TableHead>\s*<TableHead>Date of delivery<\/TableHead>/);
  assert.match(page, /sub\.deliveredDate \? formatDate\(sub\.deliveredDate\) : '—'/);
  assert.match(page, /aria-label=\{`Edit date of delivery for \$\{shortSubOrderId\(order, sub\)\}`\}/);
});
