const { invoiceNumber, creditNoteNumber, lineTax, shipToState, fromPaise, toPaise } = require('../services/finance.service');

function escapePdfText(value) {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildPdf(lines) {
  const commands = lines.map((line, index) => `BT /F1 10 Tf 40 ${800 - index * 14} Td (${escapePdfText(line)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(commands, 'utf8')} >>\nstream\n${commands}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, 'utf8');
}

function buildInvoicePdf(order, { company = {}, warehouseState = '', kind = 'invoice' } = {}) {
  const invoiceNo = invoiceNumber(order);
  const creditNoteNo = creditNoteNumber(order);
  const number = kind === 'credit' ? creditNoteNo : invoiceNo;
  const ship = shipToState(order);
  const taxes = (order.items || []).map((item) => ({
    item,
    tax: lineTax(item, { warehouseState, shipState: ship }),
  }));
  const totalsPaise = taxes.reduce((acc, row) => ({
    taxable: acc.taxable + toPaise(row.tax.taxable),
    cgst: acc.cgst + toPaise(row.tax.cgst),
    sgst: acc.sgst + toPaise(row.tax.sgst),
    igst: acc.igst + toPaise(row.tax.igst),
    gross: acc.gross + toPaise(row.tax.gross),
  }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, gross: 0 });
  const totals = {
    taxable: fromPaise(totalsPaise.taxable),
    cgst: fromPaise(totalsPaise.cgst),
    sgst: fromPaise(totalsPaise.sgst),
    igst: fromPaise(totalsPaise.igst),
    gross: fromPaise(totalsPaise.gross),
  };
  const lines = [
    kind === 'credit' ? `Credit note ${number}` : `Tax invoice ${number}`,
    company.companyName || '',
    company.gstin ? `GSTIN ${company.gstin}` : '',
    `Order ${order.orderNo || order.id || ''}`,
    order.customer ? `Customer ${order.customer}` : '',
    `Ship-to state ${ship || '-'}`,
    `Warehouse state ${warehouseState || '-'}`,
    'Item | SKU | Qty | Taxable | CGST | SGST | IGST',
    ...taxes.map(({ item, tax }) => [
      item.name || item.sku || 'Item',
      item.sku || '',
      item.qty || 1,
      tax.taxable.toFixed(2),
      tax.cgst.toFixed(2),
      tax.sgst.toFixed(2),
      tax.igst.toFixed(2),
    ].join(' | ')),
    `Taxable ${totals.taxable.toFixed(2)}`,
    `CGST ${totals.cgst.toFixed(2)}`,
    `SGST ${totals.sgst.toFixed(2)}`,
    `IGST ${totals.igst.toFixed(2)}`,
    `Total ${totals.gross.toFixed(2)}`,
  ].filter(Boolean);
  return {
    bytes: buildPdf(lines),
    invoiceNo,
    creditNoteNo,
    number,
    ...totals,
    intraState: Boolean(taxes[0]?.tax.intraState),
  };
}

async function emailInvoicePdf({ tenantId, to, pdf, filename, subject, mailboxOf, sendMail }) {
  if (!to) return { emailed: false, skipped: true, reason: 'no recipient' };
  const box = await mailboxOf(tenantId);
  if (!box) return { emailed: false, skipped: true, reason: 'gmail' };
  try {
    const { operationalEmail } = require('./mailTemplates');
    const letter = operationalEmail({
      title: subject,
      detail: 'Your document is attached to this email.\nPlease keep it with your records.',
    });
    await sendMail({
      tenantId,
      to,
      subject: letter.subject,
      text: letter.text,
      html: letter.html,
      attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    });
    return { emailed: true, skipped: false };
  } catch (err) {
    return { emailed: false, skipped: false, mailError: err.message || 'mail failed' };
  }
}

module.exports = { buildPdf, buildInvoicePdf, emailInvoicePdf };
