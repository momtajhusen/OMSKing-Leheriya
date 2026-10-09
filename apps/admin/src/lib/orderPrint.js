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
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    return;
  }
  const blob = new Blob([html], { type: 'text/html' });
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

export function labelHtml(order, subOrderId) {
  const lines = subOrderId
    ? (order.subOrders || []).filter((sub) => sub.id === subOrderId)
    : (order.subOrders || []);
  const awb = order.awb || 'AWB pending';
  const items = lines.map((sub) => `
    <tr>
      <td>${photoHtml(sub.title || sub.sku, sub.imageUrl, 56)}</td>
      <td>${escapeHtml(sub.title)}<br/><small>${escapeHtml(sub.sku)} · ${escapeHtml(sub.id)}</small></td>
      <td>1</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Label ${escapeHtml(order.id)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 24px; color: #111; }
    .box { border: 2px solid #111; padding: 20px; max-width: 440px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    td { padding: 6px 0; vertical-align: middle; }
    .awb { font-size: 22px; letter-spacing: 0.12em; font-weight: 700; margin: 12px 0; }
  </style>
</head>
<body>
  <div class="box">
    <h1>OMSKing shipping label</h1>
    <div>Master order <strong>${escapeHtml(order.id)}</strong></div>
    <div class="awb">${escapeHtml(awb)}</div>
    <div>${escapeHtml(order.customer)}<br/>${escapeHtml(order.address || order.city || '')}</div>
    <div style="margin-top:8px">${escapeHtml(order.courier || 'Courier pending')} · ${escapeHtml(order.phone || '')}</div>
    <table>${items}</table>
  </div>
  <script>setTimeout(() => window.print(), 400)</script>
</body>
</html>`;
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
