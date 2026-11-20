const test = require('node:test');
const assert = require('node:assert/strict');
const { brandMarkHtml } = require('../src/lib/companyLogo');
const { labelHtml } = require('../src/lib/orderSubOrders');
const { buildInvoicePdf } = require('../src/lib/invoicePdf');

test('packing slip brand comes from order brandName — never a fixed Leheriya/OMSKing fallback for blank brand', () => {
  const html = labelHtml({
    channelOrderNo: 'T-1',
    customer: 'Buyer',
    address: 'Street 1',
    city: 'Jaipur',
    shipState: 'Rajasthan',
    awb: 'AWB1',
    paymentMode: 'Prepaid',
    brandName: 'Surat Silks',
    gstin: '08AAAAA0000A1Z5',
    items: [{ name: 'Saree', sku: 'S1', qty: 1, price: 100 }],
  });
  assert.match(html, /Surat Silks/);
  assert.doesNotMatch(html, /Leheriya/);
  assert.doesNotMatch(html, /OMSKing/);
});

test('invoice PDF prints only company form fields (name, website, email, phone, legal supplier)', () => {
  const company = {
    companyName: 'Acme Fabrics',
    legalName: 'ACME FABRICS PRIVATE LIMITED',
    gstin: '24AAAAA0000A1Z5',
    email: 'hello@acme.test',
    phone: '+91 9000000000',
    website: 'www.acme.test',
    address: 'Plot 1, Industrial Area',
    city: 'Surat, Gujarat',
  };
  const text = buildInvoicePdf(
    {
      channelOrderNo: '100',
      orderDate: '2026-01-15T10:00:00.000Z',
      paymentMode: 'Prepaid',
      customer: 'Buyer',
      address: 'Lane 2',
      city: 'Ahmedabad, Gujarat',
      shipState: 'Gujarat',
      items: [{ name: 'Fabric', sku: 'F1', qty: 1, price: 1050, gst: 5, hsn: '5407' }],
    },
    { warehouseState: 'Gujarat', company },
  ).bytes.toString('latin1');
  assert.ok(text.includes('Acme Fabrics'));
  assert.ok(text.includes('ACME FABRICS PRIVATE LIMITED'));
  assert.ok(text.includes('www.acme.test'));
  assert.ok(text.includes('hello@acme.test'));
  assert.ok(text.includes('+91 9000000000'));
  assert.ok(!text.includes('Leheriya'));
  assert.ok(!text.includes('OMSKing'));
});

test('brandMarkHtml escape stays tenant-agnostic', () => {
  const html = brandMarkHtml('Tenant X', '', { escapeHtml: (s) => s });
  assert.match(html, /Tenant X/);
  assert.doesNotMatch(html, /Leheriya/);
});

test('compact tax invoice seller name is legalName, else companyName — never brand/Leheriya', () => {
  const { labelInvoiceHtml } = require('../src/lib/orderSubOrders');
  const html = labelInvoiceHtml({
    channelOrderNo: '70082-LEH',
    customer: 'Kavita Singh',
    address: 'Dwarka',
    city: 'Delhi',
    shipState: 'Delhi',
    awb: 'AWB1',
    paymentMode: 'COD',
    brandName: 'Leheriya',
    companyName: 'Prdosco Global Private Limited',
    companyLegalName: '',
    companyAddress: 'Basement, Plot No 24, Sector 12, Dwarka',
    gstin: '07AAQCP4784P1ZB',
    items: [{ name: 'Dress', sku: 'LEHSF69', qty: 1, price: 2199, gst: 5 }],
  });
  assert.match(html, /Tax Invoice/);
  assert.match(html, /<b>Prdosco Global Private Limited<\/b>/);
  assert.doesNotMatch(html, /<b>Leheriya<\/b>/);
});

test('compact tax invoice prefers legalName over companyName', () => {
  const { labelInvoiceHtml } = require('../src/lib/orderSubOrders');
  const html = labelInvoiceHtml({
    channelOrderNo: '1',
    customer: 'Buyer',
    address: 'A',
    city: 'Delhi',
    awb: '1',
    paymentMode: 'Prepaid',
    brandName: 'Leheriya',
    companyName: 'Leheriya',
    companyLegalName: 'PRDOSCO GLOBAL PRIVATE LIMITED',
    companyAddress: 'Plot 24 Dwarka',
    gstin: '07AAQCP4784P1ZB',
    items: [{ name: 'Item', sku: 'S1', qty: 1, price: 100 }],
  });
  assert.match(html, /<b>PRDOSCO GLOBAL PRIVATE LIMITED<\/b>/);
  assert.doesNotMatch(html, /<b>Leheriya<\/b>/);
});
