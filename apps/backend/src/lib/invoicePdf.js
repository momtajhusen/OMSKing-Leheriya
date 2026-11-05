const {
  invoiceNumber, creditNoteNumber, lineTax, shipToState, gstStateCode, fromPaise, toPaise,
} = require('../services/finance.service');

function escapePdfText(value) {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildPdf(lines) {
  return pdfDocument(lines.map((line, index) => `BT /F1 10 Tf 40 ${800 - index * 14} Td (${escapePdfText(line)}) Tj ET`).join('\n'));
}

function pdfDocument(commands) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(commands, 'utf8')} >>\nstream\n${commands}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
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

const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE',
  'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function belowHundred(n) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function wholeInWords(n) {
  if (!n) return '';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor(n / 100000) % 100;
  const thousand = Math.floor(n / 1000) % 100;
  const hundred = Math.floor(n / 100) % 10;
  const rest = n % 100;
  if (crore) parts.push(`${wholeInWords(crore)} CRORE`);
  if (lakh) parts.push(`${belowHundred(lakh)} LAKH`);
  if (thousand) parts.push(`${belowHundred(thousand)} THOUSAND`);
  if (hundred) parts.push(`${ONES[hundred]} HUNDRED`);
  if (rest) parts.push(`${hundred ? 'AND ' : ''}${belowHundred(rest)}`);
  return parts.join(' ');
}

function amountInWords(amount) {
  const paise = Math.abs(toPaise(amount));
  const rupees = wholeInWords(Math.floor(paise / 100)) || 'ZERO';
  const cents = paise % 100 ? ` AND ${belowHundred(paise % 100)} PAISE` : '';
  return `${rupees} RUPEES${cents} ONLY`;
}

function wrapText(value, maxChars) {
  const out = [];
  let line = '';
  String(value || '').split(/\s+/).filter(Boolean).forEach((word) => {
    if (line && `${line} ${word}`.length > maxChars) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  });
  if (line) out.push(line);
  return out;
}

function rs(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function invoiceDateText(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'Asia/Kolkata' });
}

function pageCanvas() {
  const ops = ['0.6 w'];
  const pdfY = (top) => (842 - top).toFixed(1);
  return {
    ops,
    text(x, top, value, { size = 8, bold = false, align = 'left' } = {}) {
      const str = String(value ?? '');
      if (!str) return;
      const width = str.length * size * (bold ? 0.6 : 0.55);
      const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
      ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${left.toFixed(1)} ${pdfY(top)} Td (${escapePdfText(str)}) Tj ET`);
    },
    line(x1, top1, x2, top2) {
      ops.push(`${x1} ${pdfY(top1)} m ${x2} ${pdfY(top2)} l S`);
    },
    fill(x, top, w, h) {
      ops.push(`0.93 g ${x} ${pdfY(top + h)} ${w} ${h} re f 0 g`);
    },
    rect(x, top, w, h) {
      ops.push(`${x} ${pdfY(top + h)} ${w} ${h} re S`);
    },
  };
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
  const intraState = Boolean(taxes[0]?.tax.intraState);
  const orderId = String(order.channelOrderNo || '').replace(/^#/, '') || order.orderNo || order.id || '';
  const L = 20;
  const R = 575;
  const page = pageCanvas();

  page.text(L + 6, 36, company.gstin ? `GSTIN: ${company.gstin}` : '', { size: 10, bold: true });
  page.text(297, 36, kind === 'credit' ? 'Credit Note' : 'Tax Invoice', { size: 11, bold: true, align: 'center' });
  page.text(R - 6, 36, 'Original', { size: 10, align: 'right' });
  page.line(L, 46, R, 46);
  page.text(297, 80, company.companyName || '', { size: 18, bold: true, align: 'center' });
  page.text(L + 6, 104, company.email || '');
  page.text(297, 104, company.website || '', { align: 'center' });
  page.text(R - 6, 104, company.phone || '', { align: 'right' });
  page.line(L, 114, R, 114);

  const info = [
    kind === 'credit' ? `Credit Note No: ${number}` : `Invoice No: ${number}`,
    kind === 'credit' ? `Invoice No: ${invoiceNo}` : '',
    `Order Id: ${orderId}`,
    `Invoice Date: ${invoiceDateText(order.invoiceGeneratedAt || order.orderDate)}`,
    `Payment: ${order.paymentMode || ''}`,
  ].filter(Boolean);
  info.forEach((row, index) => page.text(L + 6, 130 + index * 13, row));
  const supplyPlace = String(order.city || '').replace(/\b\d{6}\b/, '').replace(/[\s,]+$/, '').trim() || ship;
  page.text(300, 130, 'Place of Supply', { bold: true });
  page.text(300, 143, supplyPlace || '-');
  page.text(450, 143, `State Code: ${gstStateCode(ship) || '-'}`);
  let top = 130 + info.length * 13 + 4;
  page.line(L, top, R, top);

  const third = (R - L) / 3;
  ['BILLED TO', 'SHIP TO', 'SUPPLIER'].forEach((label, index) => {
    page.text(L + third * index + third / 2, top + 12, label, { size: 10, bold: true, align: 'center' });
  });
  page.line(L + third, top, L + third, top + 16);
  page.line(L + third * 2, top, L + third * 2, top + 16);
  page.line(L, top + 16, R, top + 16);
  const customerBlock = [
    ...wrapText(order.customer, 34).map((text) => ({ text, bold: true })),
    ...wrapText(order.address, 38).map((text) => ({ text })),
    { text: order.city },
    { text: order.phone ? `Tel: ${order.phone}` : '' },
  ];
  const supplierBlock = [
    ...wrapText(company.legalName || company.companyName, 34).map((text) => ({ text, bold: true })),
    ...wrapText(company.address, 38).map((text) => ({ text })),
    { text: company.city },
    { text: company.phone ? `Tel: ${company.phone}` : '' },
    { text: company.email ? `Email: ${company.email}` : '' },
    { text: company.gstin ? `GSTIN: ${company.gstin}` : '' },
  ];
  const billedBlock = [...customerBlock, { text: order.customerGstin ? `GSTIN: ${order.customerGstin}` : '' }];
  const blocks = [billedBlock, customerBlock, supplierBlock].map((rows) => rows.filter((row) => row.text));
  blocks.forEach((rows, index) => rows.forEach((row, at) => {
    page.text(L + third * index + 6, top + 30 + at * 11, row.text, { bold: row.bold });
  }));
  top += 30 + Math.max(...blocks.map((rows) => rows.length)) * 11;
  page.line(L, top, R, top);

  const cols = intraState
    ? { qty: 160, rate: 190, taxable: 262, hsn: 330, gst: 370, tax1: 400, tax2: 460, total: 520 }
    : { qty: 160, rate: 190, taxable: 262, hsn: 330, gst: 370, tax1: 410, tax2: null, total: 500 };
  top += 10;
  page.fill(L, top, R - L, 18);
  page.line(L, top, R, top);
  [['Item', L + 6], ['Qty', cols.qty], ['Rate', cols.rate], ['Taxable Val', cols.taxable], ['HSN', cols.hsn],
    ['GST', cols.gst], [intraState ? 'CGST' : 'IGST', cols.tax1], [intraState ? 'SGST' : '', cols.tax2], ['Total', cols.total]]
    .forEach(([label, x]) => { if (label) page.text(x, top + 12, label, { bold: true }); });
  top += 18;
  page.line(L, top, R, top);
  let rateSumPaise = 0;
  taxes.forEach(({ item, tax }) => {
    const nameLines = wrapText(item.name || item.sku || 'Item', 30);
    rateSumPaise += toPaise(item.price);
    nameLines.forEach((text, at) => page.text(L + 6, top + 13 + at * 10, text));
    page.text(cols.qty, top + 13, item.qty || 1);
    page.text(cols.rate, top + 13, rs(item.price));
    page.text(cols.taxable, top + 13, rs(tax.taxable));
    page.text(cols.hsn, top + 13, item.hsn || '');
    page.text(cols.gst, top + 13, `${tax.rate}%`);
    page.text(cols.tax1, top + 13, rs(intraState ? tax.cgst : tax.igst));
    if (intraState) page.text(cols.tax2, top + 13, rs(tax.sgst));
    page.text(cols.total, top + 13, rs(tax.gross));
    top += 8 + nameLines.length * 10;
    page.line(L, top, R, top);
  });
  page.text(L + 6, top + 13, 'Total', { bold: true });
  page.text(cols.rate, top + 13, rs(fromPaise(rateSumPaise)), { bold: true });
  page.text(cols.taxable, top + 13, rs(totals.taxable), { bold: true });
  page.text(cols.tax1, top + 13, rs(intraState ? totals.cgst : totals.igst), { bold: true });
  if (intraState) page.text(cols.tax2, top + 13, rs(totals.sgst), { bold: true });
  page.text(cols.total, top + 13, rs(totals.gross), { bold: true });
  top += 20;
  page.line(L, top, R, top);

  top += 24;
  page.text(L + 6, top, 'Terms and Conditions apply', { bold: true });
  page.line(L + 6, top + 6, 280, top + 6);
  page.text(L + 6, top + 20, 'Amount in words', { bold: true });
  const words = wrapText(amountInWords(totals.gross), 62);
  words.forEach((text, at) => page.text(L + 6, top + 33 + at * 10, text));
  const wordsEnd = top + 33 + words.length * 10;
  page.line(L + 6, wordsEnd, 280, wordsEnd);
  page.text(L + 6, wordsEnd + 14, 'E. & O.E', { bold: true });

  const taxTotal = intraState ? fromPaise(toPaise(totals.cgst) + toPaise(totals.sgst)) : totals.igst;
  const summary = [
    ['Total Amount before Tax:', rs(totals.taxable)],
    ['Total Tax Amount:', rs(taxTotal)],
    ...(intraState
      ? [['Total CGST:', rs(totals.cgst)], ['Total SGST:', rs(totals.sgst)]]
      : [['Total IGST:', rs(totals.igst)]]),
    ['Total Amount After Tax:', rs(totals.gross)],
  ];
  summary.forEach(([label, value], at) => {
    page.text(350, top + at * 14, label, { bold: true });
    page.text(R - 10, top + at * 14, value, { bold: true, align: 'right' });
  });
  const totalTop = top + summary.length * 14 + 4;
  page.rect(346, totalTop - 11, R - 6 - 346, 16);
  page.text(350, totalTop, 'Total', { bold: true });
  page.text(R - 10, totalTop, rs(totals.gross), { bold: true, align: 'right' });

  top = Math.max(wordsEnd + 14, totalTop) + 24;
  page.line(L, top, R, top);
  page.text(297, top + 22, 'This is computer generated invoice and hence no signature is required', { size: 10, align: 'center' });
  page.rect(L, 20, R - L, top + 36 - 20);
  return {
    bytes: pdfDocument(page.ops.join('\n')),
    invoiceNo,
    creditNoteNo,
    number,
    ...totals,
    intraState,
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
