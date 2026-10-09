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
  assert.match(text, /IGST 0\.00/);

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
