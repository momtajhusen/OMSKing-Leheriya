function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

export function openPrintHtml(html, filename = 'omsking-document.html') {
  // Auto-print after paint so Chrome uses @page size before the user changes margins.
  const withPrint = /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `<script>
(function () {
  function go() { try { window.focus(); window.print(); } catch (e) {} }
  if (document.readyState === 'complete') setTimeout(go, 50);
  else window.addEventListener('load', function () { setTimeout(go, 50); });
})();
</script></body>`)
    : html;
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (win) {
    win.document.open();
    win.document.write(withPrint);
    win.document.close();
    return;
  }
  const blob = new Blob([withPrint], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function photoHtml(name, src, size = 40) {
  if (/^https?:\/\//i.test(String(src || ''))) {
    return `<img src="${escapeHtml(src)}" alt="" width="${size}" height="${size}" style="object-fit:cover;border-radius:8px" />`;
  }
  const letter = escapeHtml(String(name || '?').charAt(0).toUpperCase());
  return `<div style="width:${size}px;height:${size}px;border-radius:8px;background:#0f766e;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">${letter}</div>`;
}

const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];

function barcodeSvg(value, { height = 56, unit = 1.35 } = {}) {
  const text = String(value || '').trim();
  if (!text || /[^\x20-\x7e]/.test(text)) return '';
  const codes = [104, ...[...text].map((char) => char.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, i) => sum + code * (i || 1), 0) % 103;
  const modules = [...codes, checksum].map((code) => CODE128[code]).concat('2331112').join('').split('').map(Number);
  const quiet = 8;
  const width = quiet * 2 + modules.reduce((sum, w) => sum + w, 0) * unit;
  let x = quiet;
  const rects = [];
  modules.forEach((w, i) => {
    if (i % 2 === 0) rects.push(`<rect x="${x.toFixed(1)}" y="0" width="${(w * unit).toFixed(1)}" height="${height}" />`);
    x += w * unit;
  });
  return `<svg class="barcode" xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height}" viewBox="0 0 ${width.toFixed(0)} ${height}" role="img" aria-label="barcode">${rects.join('')}</svg>`;
}

function pinOf(order) {
  const blob = `${order.pincode || ''} ${order.city || ''} ${order.address || ''} ${order.shipState || ''}`;
  const match = blob.match(/\b(\d{6})\b/);
  return match ? match[1] : '';
}

function paymentOf(order) {
  const raw = `${order.labelPaymentMode || ''} ${order.paymentMode || ''}`;
  const cod = /cod|cash on delivery/i.test(raw);
  const amount = Number(order.codAmount) > 0
    ? Number(order.codAmount)
    : (cod ? Number(order.total) || 0 : 0);
  return {
    mode: cod ? 'COD' : (/void/i.test(raw) ? 'Void' : 'Pre-Paid'),
    amount,
    amountText: amount > 0
      ? amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })
      : '',
  };
}

function cityOf(order, pin) {
  return String(order.city || '').replace(new RegExp(`\\b${pin}\\b`), '').replace(/\s+/g, ' ').trim();
}

function weightKgOf(order) {
  if (Number(order.weightKg) > 0) return Number(order.weightKg);
  const fromItems = (order.items || []).reduce((sum, item) => sum + (Number(item.pack?.weightKg) || 0), 0);
  return fromItems > 0 ? Math.round(fromItems * 100) / 100 : 0;
}

function pieceCountOf(lines) {
  return Math.max(1, lines.reduce((sum, row) => sum + Math.max(1, Number(row.qty) || 1), 0));
}

function serviceOf(order) {
  const text = `${order.courier || ''} ${order.serviceType || ''}`.toLowerCase();
  if (/surface|maruti|delhivery/.test(text) && /surface/.test(text)) return 'Surface';
  return 'Domestic Priority';
}

function courierTitle(order) {
  const name = String(order.courier || 'Courier').trim();
  if (/blue\s*dart/i.test(name)) return 'BLUE DART';
  if (/shree\s*maruti|maruti/i.test(name)) return 'SHREE MARUTI';
  if (/delhivery/i.test(name)) return 'DELHIVERY';
  if (/amazon/i.test(name)) return 'AMAZON SHIPPING';
  return name.toUpperCase() || 'COURIER';
}

function moneyInr(value) {
  const n = Number(value) || 0;
  return `INR ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function labelLines(order, subOrderId) {
  if (subOrderId) return (order.subOrders || []).filter((sub) => sub.id === subOrderId);
  if ((order.subOrders || []).length) return order.subOrders;
  return (order.items || []).map((item, idx) => ({
    id: `${order.id || order.orderNo}-${idx + 1}`,
    title: item.name || item.title || '',
    sku: item.sku || '',
    imageUrl: item.imageUrl || '',
    qty: item.qty || 1,
  }));
}

function returnAddressOf(order) {
  if (order.returnAddress) return String(order.returnAddress).trim();
  const parts = [
    order.warehouseName,
    order.warehouseLine1 || order.warehouseAddress,
    [order.warehouseCity, order.warehouseState, order.warehousePincode].filter(Boolean).join(' '),
    order.warehousePhone ? `Ph ${order.warehousePhone}` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

function packDimsOf(order) {
  const packs = (order.items || []).map((item) => item.pack).filter(Boolean);
  if (!packs.length && order.pack) packs.push(order.pack);
  const length = Math.max(0, ...packs.map((p) => Number(p.lengthCm) || 0), Number(order.lengthCm) || 0);
  const breadth = Math.max(0, ...packs.map((p) => Number(p.breadthCm) || 0), Number(order.breadthCm) || 0);
  const height = Math.max(0, ...packs.map((p) => Number(p.heightCm) || 0), Number(order.heightCm) || 0);
  if (!(length || breadth || height)) return '—';
  return `${Math.round(length)}x${Math.round(breadth)}x${Math.round(height)} cm`;
}

function brandOf(order) {
  return String(order.brandName || order.shopName || order.tenantName || order.companyName || '').trim() || 'Company';
}

function invoiceSellerName(order) {
  return String(order.companyLegalName || order.companyName || order.tenantName || '').trim()
    || brandOf(order);
}

function formatLabelDate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function courierLine(order, awb) {
  const name = String(order.courier || 'Courier').trim() || 'Courier';
  return `${name}: ${awb}`;
}

function returnBlock(order) {
  const brand = brandOf(order);
  const parts = [
    brand,
    order.warehouseLine1 || order.warehouseAddress || order.returnAddress || '',
    [order.warehouseCity, order.warehouseState, order.warehousePincode].filter(Boolean).join(', '),
  ].filter(Boolean);
  return parts.join(', ') || brand;
}

function packingSlipModel(order, subOrderId) {
  const lines = labelLines(order, subOrderId);
  const skus = new Set(lines.map((line) => String(line.sku || '').trim()).filter(Boolean));
  const fromOrderItems = (order.items || []).filter((item) => !subOrderId || skus.has(String(item.sku || '').trim()));
  const displayItems = fromOrderItems.length
    ? fromOrderItems
    : lines.map((line) => ({
      name: line.title || line.name, sku: line.sku, qty: line.qty, gst: 0, price: line.price || 0,
    }));
  const awb = String(order.awb || '').trim() || 'AWB pending';
  const pay = paymentOf(order);
  const pin = pinOf(order);
  const city = cityOf(order, pin);
  const channelNo = String(order.channelOrderNo || '').replace(/^#/, '') || '—';
  let taxLines = [];
  let totals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, gross: Number(order.total) || 0 };
  try {
    const { invoiceTotals } = require('../services/finance.service');
    const computed = invoiceTotals({ ...order, items: displayItems }, {
      warehouseState: order.warehouseState || '',
      shipState: order.shipState || city || '',
    });
    taxLines = computed.lines;
    totals = computed.totals;
  } catch {
    taxLines = displayItems.map((item) => ({ item, tax: { igst: 0, taxable: Number(item.price) || 0, gross: (Number(item.price) || 0) * (Number(item.qty) || 1) } }));
  }
  return {
    displayItems,
    awb,
    payLabel: pay.mode === 'COD' ? 'COD' : (pay.mode === 'Void' ? 'VOID' : 'PREPAID'),
    pin,
    city,
    channelNo,
    invoiceNo: String(order.invoiceNo || channelNo).replace(/^#/, ''),
    pieces: displayItems.reduce((sum, item) => sum + Math.max(1, Number(item.qty) || 1), 0) || 1,
    weightText: (() => {
      const weight = weightKgOf(order);
      return weight > 0 ? `${weight.toFixed(2)} Kg` : '—';
    })(),
    when: formatLabelDate(order.createdAt || order.orderDate || order.labelGeneratedAt),
    brand: brandOf(order),
    logoSrc: String(order.logoSrc || order.logoUrl || '').trim(),
    logoUrl: String(order.logoUrl || '').trim(),
    gstin: String(order.gstin || order.companyGstin || '').trim() || '—',
    shipTo: [
      escapeHtml(order.customer || 'Customer'),
      escapeHtml([order.address, city, order.shipState, 'India', pin].filter(Boolean).join(', ')),
    ].join('<br/>'),
    taxLines,
    totals,
  };
}

function brandCellHtml(model) {
  const name = escapeHtml(model.brand || 'Company');
  const src = String(model.logoSrc || model.logoUrl || '').trim();
  if (src && (/^data:image\//i.test(src) || /^https?:\/\//i.test(src))) {
    return `<img class="brand-logo" src="${escapeHtml(src)}" alt="${name}" />`;
  }
  return `<div class="brand-mark">${name}</div><div class="brand-sub">${name}</div>`;
}

function packingSlipSheet(model, order) {
  const productRows = model.taxLines.map(({ item, tax }, index) => {
    const name = item.name || item.title || 'Item';
    const sku = item.sku ? ` (SKU:${item.sku})` : '';
    const qty = Math.max(1, Number(item.qty) || 1);
    const igst = Number(tax?.igst) || 0;
    return `<tr>
      <td class="c">${index + 1}</td>
      <td>${escapeHtml(name)}${escapeHtml(sku)}</td>
      <td class="c">${qty}</td>
      <td class="r">${igst ? igst.toFixed(2) : '—'}</td>
    </tr>`;
  }).join('') || `<tr><td class="c">1</td><td>—</td><td class="c">1</td><td class="r">—</td></tr>`;

  return `<div class="sheet">
    <div class="row">
      <div class="cell brand">
        <div class="brand-wrap">${brandCellHtml(model)}</div>
      </div>
      <div class="cell ship split">
        <div class="k">Ship to:</div>
        ${model.shipTo}
      </div>
    </div>
    <div class="row track">
      <div class="who">${escapeHtml(courierLine(order, model.awb))}</div>
      ${barcodeSvg(model.awb, { height: 52, unit: 1.4 })}
    </div>
    <div class="row">
      <div class="cell pay">${escapeHtml(model.payLabel)}</div>
      <div class="cell meta split">
        <div><b>Order Date:</b> ${escapeHtml(model.when)}</div>
        <div><b>Invoice No:</b> ${escapeHtml(model.invoiceNo)}</div>
        <div><b>Invoice Date:</b> ${escapeHtml(model.when)}</div>
        <div><b>Pieces:</b> ${model.pieces}</div>
        <div><b>Channel:</b> ${escapeHtml(order.channel || '—')}</div>
        <div><b>Dim | Wt:</b> ${escapeHtml(packDimsOf(order))} | ${escapeHtml(model.weightText)}</div>
      </div>
    </div>
    <div class="row"><div class="cell oid" style="flex:1">Order Id: ${escapeHtml(model.channelNo)}</div></div>
    <div class="row">
      <table class="items">
        <thead>
          <tr><th class="c">#</th><th>Product Name &amp; SKU</th><th class="c">Qty</th><th class="r">IGST</th></tr>
        </thead>
        <tbody>${productRows}</tbody>
      </table>
    </div>
    <div class="row">
      <div class="cell ret" style="flex:1">
        <div><b>Return Address:</b> ${escapeHtml(returnBlock(order))}</div>
        <div style="margin-top:6px"><b>GSTIN No.:</b> ${escapeHtml(model.gstin)}</div>
      </div>
    </div>
  </div>`;
}

function compactInvoiceSheet(model, order) {
  const rows = model.taxLines.map(({ item, tax }, index) => {
    const qty = Math.max(1, Number(item.qty) || 1);
    return `<tr>
      <td class="c">${index + 1}</td>
      <td>${escapeHtml(item.name || item.title || 'Item')}${item.sku ? `<div class="sku">${escapeHtml(item.sku)}</div>` : ''}</td>
      <td class="c">${qty}</td>
      <td class="r">${(Number(tax.taxable) || 0).toFixed(2)}</td>
      <td class="r">${((Number(tax.cgst) || 0) + (Number(tax.sgst) || 0) + (Number(tax.igst) || 0)).toFixed(2)}</td>
      <td class="r">${(Number(tax.gross) || 0).toFixed(2)}</td>
    </tr>`;
  }).join('');
  return `<div class="sheet invoice">
    <div class="row"><div class="cell oid" style="flex:1">Tax Invoice · ${escapeHtml(model.invoiceNo)}</div></div>
    <div class="row">
      <div class="cell meta" style="flex:1">
        <div class="brand-wrap" style="margin-bottom:4px">${brandCellHtml(model)}</div>
        <div><b>${escapeHtml(invoiceSellerName(order))}</b></div>
        <div>${escapeHtml(order.companyAddress || returnBlock({ ...order, brandName: invoiceSellerName(order) }))}</div>
        ${order.companyCity ? `<div>${escapeHtml(order.companyCity)}${order.companyState ? `, ${escapeHtml(order.companyState)}` : ''}</div>` : ''}
        ${order.companyEmail ? `<div>${escapeHtml(order.companyEmail)}</div>` : ''}
        ${order.companyPhone ? `<div>${escapeHtml(order.companyPhone)}</div>` : ''}
        ${order.companyWebsite ? `<div>${escapeHtml(order.companyWebsite)}</div>` : ''}
        <div><b>GSTIN:</b> ${escapeHtml(model.gstin)}</div>
      </div>
      <div class="cell meta split" style="flex:1">
        <div><b>Bill to:</b> ${escapeHtml(order.customer || 'Customer')}</div>
        <div>${escapeHtml([order.address, model.city, order.shipState, model.pin].filter(Boolean).join(', '))}</div>
        <div><b>Order:</b> ${escapeHtml(model.channelNo)}</div>
        <div><b>Date:</b> ${escapeHtml(model.when)}</div>
        <div><b>Payment:</b> ${escapeHtml(model.payLabel)}</div>
      </div>
    </div>
    <div class="row">
      <table class="items">
        <thead>
          <tr><th class="c">#</th><th>Item</th><th class="c">Qty</th><th class="r">Taxable</th><th class="r">Tax</th><th class="r">Total</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="row">
      <div class="cell meta" style="flex:1;text-align:right">
        <div>Taxable: ₹${(Number(model.totals.taxable) || 0).toFixed(2)}</div>
        <div>CGST: ₹${(Number(model.totals.cgst) || 0).toFixed(2)} · SGST: ₹${(Number(model.totals.sgst) || 0).toFixed(2)} · IGST: ₹${(Number(model.totals.igst) || 0).toFixed(2)}</div>
        <div style="font-size:16px;font-weight:800;margin-top:4px">Grand Total: ₹${(Number(model.totals.gross) || Number(order.total) || 0).toFixed(2)}</div>
      </div>
    </div>
  </div>`;
}

const PACK_STYLES = `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #111; background: #fff;
      font-family: Arial, Helvetica, sans-serif; }
    /* Never use page-break-after — Chrome prints a blank trailing page.
       Only break BEFORE the next .page when Label+Invoice has two sheets. */
    .page { width: 4in; height: 6in; padding: 0.08in; overflow: hidden;
      page-break-after: auto; break-after: auto;
      page-break-before: auto; break-before: auto;
      page-break-inside: auto; break-inside: auto; }
    .page + .page { page-break-before: always; break-before: page; }
    .sheet { width: 100%; height: 100%; border: 1.5px solid #111; overflow: hidden; }
    .row { display: flex; border-bottom: 1.5px solid #111; }
    .row:last-child { border-bottom: 0; }
    .cell { padding: 6px 8px; }
    .split { border-left: 1.5px solid #111; }
    .brand { flex: 0 0 38%; display: flex; align-items: center; justify-content: center; }
    .brand-wrap { text-align: center; max-width: 100%; }
    .brand-logo { display: block; max-width: 1.35in; max-height: 0.7in; margin: 0 auto;
      object-fit: contain; }
    .brand-mark { font-family: Georgia, "Times New Roman", serif; font-size: 22px; font-style: italic;
      font-weight: 700; letter-spacing: 0.02em; }
    .brand-sub { font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: 800;
      font-style: normal; margin-top: 2px; letter-spacing: 0.04em; }
    .ship { flex: 1; font-size: 11px; line-height: 1.3; }
    .ship .k { font-weight: 700; margin-bottom: 3px; }
    .track { flex-direction: column; align-items: stretch; text-align: center; padding: 6px 8px 4px; }
    .track .who { font-size: 12px; font-weight: 700; margin-bottom: 3px; }
    .barcode { display: inline-block; max-width: 100%; height: 42px; }
    .pay { flex: 0 0 34%; display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 900; letter-spacing: 0.02em; }
    .meta { flex: 1; font-size: 10px; line-height: 1.35; }
    .meta b { font-weight: 700; }
    .oid { text-align: center; font-size: 13px; font-weight: 800; padding: 5px 8px; }
    table.items { width: 100%; border-collapse: collapse; font-size: 10px; }
    table.items th, table.items td { border-top: 1px solid #111; padding: 4px 5px; vertical-align: top; }
    table.items th { background: #f3f3f3; text-align: left; font-size: 9px; }
    table.items .c { text-align: center; width: 26px; }
    table.items .r { text-align: right; width: 48px; }
    table.items .sku { font-size: 9px; color: #444; }
    .ret { font-size: 10px; line-height: 1.3; }
    .ret b { font-weight: 700; }
    @media print {
      @page { size: 4in 6in; margin: 0; }
      html, body {
        width: 4in !important; height: auto !important;
        margin: 0 !important; padding: 0 !important; overflow: hidden !important;
      }
      .page {
        width: 3.95in !important; height: 5.85in !important; max-height: 5.85in !important;
        margin: 0 !important; padding: 0.05in !important; overflow: hidden !important;
        page-break-after: auto !important; break-after: auto !important;
        page-break-inside: auto !important; break-inside: auto !important;
      }
      .page + .page { page-break-before: always !important; break-before: page !important; }
    }
`;

/**
 * One packing-slip label for every courier (Delhivery / Blue Dart / Shree Maruti / …).
 * Layout: brand + ship-to, courier AWB barcode, PREPAID|COD + meta, order items, return + GSTIN.
 * Pass { withInvoice: true } for Shipway-style Label + Invoice on two 4×6 pages.
 */
export function labelHtml(order, subOrderId, { withInvoice = false } = {}) {
  const model = packingSlipModel(order, subOrderId);
  const title = withInvoice
    ? `Label+Invoice ${model.channelNo}`
    : `Label ${model.channelNo} · ${model.awb}`;
  const pages = [
    `<div class="page">${packingSlipSheet(model, order)}</div>`,
    ...(withInvoice ? [`<div class="page">${compactInvoiceSheet(model, order)}</div>`] : []),
  ].join('\n');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${PACK_STYLES}</style>
</head>
<body>
  ${pages}
</body>
</html>`;
}

export function labelInvoiceHtml(order, subOrderId) {
  return labelHtml(order, subOrderId, { withInvoice: true });
}

function pdfBlob(base64) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'application/pdf' });
}

export function openPdfBase64(base64, filename) {
  const url = URL.createObjectURL(pdfBlob(base64));
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) downloadPdfBase64(base64, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function downloadPdfBase64(base64, filename) {
  const url = URL.createObjectURL(pdfBlob(base64));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'invoice.pdf';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function invoiceHtml(order) {
  const invoiceNo = order.invoiceNo || (order.channel === 'Shopify' ? order.id : `INV-${order.id}`);
  const rows = (order.items || []).map((item) => `
    <tr>
      <td>${photoHtml(item.name || item.sku, item.imageUrl)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.sku)}</td>
      <td>${item.qty}</td>
      <td>₹${Number(item.price || 0).toLocaleString('en-IN')}</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${escapeHtml(invoiceNo)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 32px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
  </style>
</head>
<body>
  <h1>Tax invoice ${escapeHtml(invoiceNo)}</h1>
  <p>Order ${escapeHtml(order.id)} · ${escapeHtml(order.customer)} · ${escapeHtml(order.address || '')}</p>
  <table>
    <thead><tr><th></th><th>Item</th><th>SKU</th><th>Qty</th><th>Price</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top:16px;font-weight:700">Total ₹${Number(order.total || 0).toLocaleString('en-IN')}</p>
  <script>setTimeout(() => window.print(), 400)</script>
</body>
</html>`;
}

export function reverseLabelHtml(order, pickup = {}) {
  const awb = pickup.awb || order.reversePickup?.awb || 'AWB pending';
  const returnId = pickup.returnId || order.reversePickup?.returnId || '';
  const courier = pickup.courier || order.reversePickup?.courier || order.courier || 'Courier pending';
  const rows = (order.items || []).map((item) => `
    <tr>
      <td>${photoHtml(item.name || item.sku, item.imageUrl)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.sku)}</td>
      <td>${item.qty}</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Reverse pickup ${escapeHtml(returnId || order.id)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 24px; color: #111; }
    .box { border: 2px solid #111; padding: 20px; max-width: 440px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    .awb { font-size: 22px; letter-spacing: 0.12em; font-weight: 700; margin: 12px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    td { padding: 6px 0; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <div class="box">
    <h1>Reverse pickup label</h1>
    <div>Return <strong>${escapeHtml(returnId)}</strong></div>
    <div>Master order ${escapeHtml(order.id)}</div>
    <div class="awb">${escapeHtml(awb)}</div>
    <div>${escapeHtml(order.customer)}<br/>${escapeHtml(order.address || order.city || '')}</div>
    <div style="margin-top:8px">${escapeHtml(courier)} · pickup from customer</div>
    <table>${rows}</table>
  </div>
  <script>setTimeout(() => window.print(), 400)</script>
</body>
</html>`;
}
