const test = require('node:test');
const assert = require('node:assert/strict');
const { labelHtml, labelInvoiceHtml } = require('../src/lib/orderSubOrders');

const sample = {
  id: 'SHP-19115831230557',
  orderNo: 'SHP-19115831230557',
  channelOrderNo: '69945-LEH',
  channel: 'Shopify',
  customer: 'Indu Nagpal',
  phone: '+919873384751',
  address: 'Tulip Ivory Villa No 16 sector 70',
  city: 'Gurugram 122004',
  shipState: 'Haryana',
  courier: 'Delhivery',
  awb: '64747510091545',
  paymentMode: 'Prepaid',
  labelPaymentMode: '',
  total: 1499,
  brandName: 'Leheriya',
  gstin: '07AAQCP4784P1ZB',
  warehouseLine1: 'Plot no 24, Basement, AU Small Finance Bank Building, Sector 12-A Road, Sector 12, Dwarka',
  warehouseCity: 'South West Delhi',
  warehouseState: 'DL',
  warehousePincode: '110078',
  createdAt: '2026-11-17T15:06:00.000Z',
  items: [{
    name: 'Bandhani Silk Dollar Buti Banarasi Bandhej Dupatta',
    sku: 'LEHKCPC905',
    qty: 1,
    price: 1499,
    gst: 5,
    pack: { weightKg: 0.45, lengthCm: 10, breadthCm: 10, heightCm: 10 },
  }],
};

test('all-order packing slip: brand, ship-to, courier barcode, PREPAID, items, return GSTIN', () => {
  const html = labelHtml(sample);
  assert.match(html, /Leheriya/);
  assert.match(html, /Ship to:/);
  assert.match(html, /Indu Nagpal/);
  assert.match(html, /Gurugram|122004/);
  assert.match(html, /Delhivery:\s*64747510091545/);
  assert.match(html, /rect /);
  assert.match(html, /PREPAID/);
  assert.match(html, /Order Date:/);
  assert.match(html, /Invoice No:/);
  assert.match(html, /69945-LEH/);
  assert.match(html, /Pieces:/);
  assert.match(html, /Channel:/);
  assert.match(html, /Shopify/);
  assert.match(html, /10x10x10 cm/);
  assert.match(html, /0\.45 Kg/);
  assert.match(html, /Order Id:\s*69945-LEH/);
  assert.match(html, /Product Name/);
  assert.match(html, /LEHKCPC905/);
  assert.match(html, /Return Address:/);
  assert.match(html, /Dwarka/);
  assert.match(html, /GSTIN No\.:/);
  assert.match(html, /07AAQCP4784P1ZB/);
  assert.doesNotMatch(html, /OMSKing shipping label/);
  assert.doesNotMatch(html, /Fashion Street/);
});

test('COD orders show COD on the same packing-slip layout', () => {
  const html = labelHtml({ ...sample, paymentMode: 'COD', labelPaymentMode: 'COD', courier: 'Shree Maruti', awb: 'PRDO0000000073' });
  assert.match(html, /\bCOD\b/);
  assert.match(html, /Shree Maruti:\s*PRDO0000000073/);
  assert.match(html, /Ship to:/);
  assert.match(html, /Return Address:/);
});

test('Blue Dart uses the same packing-slip format', () => {
  const html = labelHtml({ ...sample, courier: 'Bluedart', awb: '80200589770' });
  assert.match(html, /Bluedart:\s*80200589770/);
  assert.match(html, /PREPAID/);
  assert.match(html, /Order Id:/);
});

test('Label + Invoice is two 4×6 pages with tax invoice on page 2', () => {
  const html = labelInvoiceHtml(sample);
  assert.match(html, /size:\s*4in 6in/);
  // Break before page 2 only — never page-break-after (Chrome blank page).
  assert.match(html, /\.page \+ \.page\s*\{[^}]*page-break-before:\s*always/);
  assert.doesNotMatch(html, /page-break-after:\s*always/);
  assert.doesNotMatch(html, /break-after:\s*page\b/);
  assert.equal((html.match(/class="page"/g) || []).length, 2);
  assert.match(html, /Ship to:/);
  assert.match(html, /Tax Invoice/);
  assert.match(html, /Grand Total/);
  assert.match(html, /07AAQCP4784P1ZB/);
  assert.match(html, /LEHKCPC905/);
});

test('Generate Label alone is one page — no trailing blank sheet', () => {
  const html = labelHtml(sample);
  assert.equal((html.match(/class="page"/g) || []).length, 1);
  assert.doesNotMatch(html, /page-break-after:\s*always/);
  assert.match(html, /page-break-after:\s*auto/);
  // Print box stays under paper size so Chrome Minimum margins cannot spill page 2.
  assert.match(html, /@media print[\s\S]*?\.page\s*\{[^}]*max-height:\s*5\.85in/);
  assert.match(html, /@media print[\s\S]*?height:\s*5\.85in/);
});

test('company logo replaces brand text on packing slip and tax invoice page', () => {
  const logoSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const html = labelInvoiceHtml({ ...sample, logoSrc });
  assert.match(html, /class="brand-logo"/);
  assert.match(html, /data:image\/png;base64,/);
  assert.equal((html.match(/class="brand-logo"/g) || []).length, 2);
  assert.doesNotMatch(html, /class="brand-mark"/);
});

test('without logo the packing slip still shows brand text', () => {
  const html = labelHtml(sample);
  assert.match(html, /class="brand-mark"/);
  assert.doesNotMatch(html, /class="brand-logo"/);
});
