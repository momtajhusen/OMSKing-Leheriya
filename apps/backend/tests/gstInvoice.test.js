const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInvoicePdf, emailInvoicePdf } = require('../src/lib/invoicePdf');

test('one order PDF starts with %PDF, intra-state IGST is 0, and email is skipped without Gmail', async () => {
  const order = {
    channel: 'Shopify',
    orderNo: 'SHP-9',
    externalOrderId: '567890',
    customer: 'Asha',
    city: 'Jaipur, Rajasthan',
    items: [{ name: 'Kurta', sku: 'K1', qty: 1, price: 118, gst: 18 }],
  };
  const pdf = buildInvoicePdf(order, {
    warehouseState: 'Rajasthan',
    company: { companyName: 'Leheriya', gstin: '08AAAAA0000A1Z5' },
  });
  assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF');
  assert.equal(pdf.invoiceNo, '567890');
  assert.equal(pdf.creditNoteNo, 'CN-567890');
  assert.equal(pdf.igst, 0);
  assert.ok(pdf.cgst > 0 && pdf.sgst > 0);
  const text = pdf.bytes.toString('latin1');
  assert.match(text, /567890/);
  assert.match(text, /Total CGST:/);
  assert.doesNotMatch(text, /IGST/);

  const out = buildInvoicePdf(
    { ...order, city: 'Mumbai, Maharashtra' },
    { warehouseState: 'Rajasthan' },
  );
  assert.equal(out.cgst, 0);
  assert.equal(out.sgst, 0);
  assert.ok(out.igst > 0);

  let sent = 0;
  const skipped = await emailInvoicePdf({
    tenantId: 'tenant',
    to: 'buyer@example.com',
    pdf: pdf.bytes,
    filename: '567890.pdf',
    subject: 'Tax invoice 567890',
    mailboxOf: async () => null,
    sendMail: async () => { sent += 1; },
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.emailed, false);
  assert.equal(sent, 0);

  const failed = await emailInvoicePdf({
    tenantId: 'tenant',
    to: 'buyer@example.com',
    pdf: pdf.bytes,
    filename: '567890.pdf',
    subject: 'Tax invoice 567890',
    mailboxOf: async () => ({ user: 'shop@gmail.com' }),
    sendMail: async () => { throw new Error('smtp down'); },
  });
  assert.equal(failed.emailed, false);
  assert.equal(failed.skipped, false);
  assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF');

  const note = buildInvoicePdf(order, { warehouseState: 'Rajasthan', kind: 'credit' });
  assert.equal(note.number, 'CN-567890');
  assert.match(note.bytes.toString('latin1'), /CN-567890/);
});

test('invoice PDF follows the client Tax Invoice format (header, three blocks, item table, totals in words)', () => {
  const order = {
    channel: 'Shopify',
    orderNo: 'SHP-51585',
    channelOrderNo: '#51585',
    orderDate: new Date('2025-12-29T10:00:00Z'),
    paymentMode: 'Prepaid',
    customer: 'Indian Farmers Fertilizer Cooperative Limited',
    phone: '+911142592791',
    address: 'C-1, DISTRICT CENTRE, SAKET',
    city: 'NEW DELHI, Delhi 110017',
    items: [
      { name: 'Bhagalpuri Madhubani Dupatta', sku: 'D1', qty: 15, price: 999, gst: 5, hsn: '5407' },
      { name: 'Handmade Cotton Kalamkari Dupatta', sku: 'D2', qty: 15, price: 799, gst: 5, hsn: '5407' },
    ],
  };
  const company = {
    companyName: 'PRDOSCO GLOBAL PRIVATE LIMITED',
    gstin: '07AAQCP4784P1ZB',
    email: 'support@leheriya.com',
    phone: '+91 9873003388',
    website: 'www.leheriya.com',
    address: 'BASEMENT, PLOT NO 24, SECTOR 12-A ROAD, SECTOR 12, DWARKA',
    city: 'New Delhi 110078',
  };
  const pdf = buildInvoicePdf(order, { warehouseState: 'Delhi', company });
  const text = pdf.bytes.toString('latin1');
  for (const part of [
    'GSTIN: 07AAQCP4784P1ZB', 'Tax Invoice', 'Original',
    'support@leheriya.com', 'www.leheriya.com', '+91 9873003388',
    'Invoice No: 51585', 'Order Id: 51585', 'Invoice Date: Dec 29, 25', 'Payment: Prepaid',
    'Place of Supply', 'State Code: 07',
    'BILLED TO', 'SHIP TO', 'SUPPLIER',
    'Taxable Val', 'HSN', 'GST', 'CGST', 'SGST',
    'Rs. 999.00', 'Rs. 14985.00', '5%', '5407',
    'Amount in words', 'TWENTY SIX THOUSAND NINE HUNDRED AND SEVENTY RUPEES ONLY',
    'Total Amount before Tax:', 'Total Tax Amount:', 'Total Amount After Tax:', 'Rs. 26970.00',
    'This is computer generated invoice and hence no signature is required',
  ]) assert.ok(text.includes(part), `invoice PDF is missing "${part}"`);
  assert.equal(pdf.gross, 26970);
  assert.ok(!text.includes('BANK DETAILS'));
  assert.ok(!text.includes('IGST'), 'intra-state invoice shows CGST + SGST, not IGST');

  const inter = buildInvoicePdf({ ...order, city: 'Mumbai, Maharashtra' }, { warehouseState: 'Delhi', company })
    .bytes.toString('latin1');
  assert.ok(inter.includes('IGST'));
  assert.ok(inter.includes('State Code: 27'));
});

test('same state splits GST half CGST half SGST, another state puts the full GST on IGST', () => {
  const { lineTax } = require('../src/services/finance.service');
  const item = (price) => ({ name: 'Leheriya Printed Dress Material', sku: 'LEH-01-300', qty: 1, price, gst: 5 });

  const delhi = lineTax(item(1591), { warehouseState: 'Delhi', shipState: 'Delhi' });
  assert.deepEqual(
    [delhi.taxable, delhi.cgst, delhi.sgst, delhi.igst, delhi.intraState],
    [1515.24, 37.88, 37.88, 0, true],
  );
  const maharashtra = lineTax(item(1359), { warehouseState: 'Delhi', shipState: 'Maharashtra' });
  assert.deepEqual(
    [maharashtra.taxable, maharashtra.cgst, maharashtra.sgst, maharashtra.igst, maharashtra.intraState],
    [1294.29, 0, 0, 64.71, false],
  );

  for (const shipState of ['New Delhi', 'DL', 'NCT of Delhi', 'delhi ']) {
    const tax = lineTax(item(1591), { warehouseState: 'Delhi', shipState });
    assert.equal(tax.intraState, true, `${shipState} is the same state as Delhi`);
    assert.equal(tax.igst, 0);
  }
  assert.equal(lineTax(item(1359), { warehouseState: 'Delhi', shipState: 'MH' }).igst, 64.71);

  const company = { companyName: 'Leheriya', gstin: '07AAQCP4784P1ZB' };
  const pdf = (order) => buildInvoicePdf({ orderNo: 'X1', items: [item(order.price)], ...order }, { warehouseState: 'Delhi', company })
    .bytes.toString('latin1');
  const intra = pdf({ price: 1591, customer: 'Praveen Dhiman', city: 'Dwarka, New Delhi 110078' });
  assert.ok(intra.includes('(Total CGST:)') && intra.includes('(Total SGST:)'));
  assert.equal(intra.split('(Rs. 37.88)').length - 1, 6, 'CGST and SGST Rs. 37.88 each, on the line, the total row and the summary');
  assert.ok(!intra.includes('IGST'));
  assert.ok(intra.includes('State Code: 07'));
  const inter = pdf({ price: 1359, customer: 'Madhuri Chandanshive', city: 'Baramati, Maharashtra 413102' });
  assert.ok(inter.includes('(Total IGST:)') && inter.includes('(Rs. 64.71)'));
  assert.ok(!inter.includes('CGST') && !inter.includes('SGST'));
});
