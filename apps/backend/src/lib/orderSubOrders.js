function masterOrderBase(orderNo) {
  return String(orderNo || '').replace(/-LEH$/i, '');
}

function productImageUrl() {
  return '';
}

function deliveryStatusFor(status) {
  if (status === 'Delivered') return 'Delivered';
  if (status === 'Dispatched') return 'In transit';
  if (['Processing', 'Packed', 'Ready to Ship'].includes(status)) return 'Processing';
  if (status === 'Cancelled') return 'Cancelled';
  return 'Pending';
}

/** extra may carry the saved Vendor row (phone/email/location) or the sub-order's stored contact. */
function vendorContact(name, extra = {}) {
  return {
    assignedVendor: name || '',
    vendorPhone: extra.vendorPhone || extra.phone || '',
    vendorEmail: extra.vendorEmail || extra.email || '',
    vendorLocation: extra.vendorLocation || extra.location || '',
  };
}

function enrichItem(item, order) {
  return {
    name: item.name || item.title || '',
    sku: item.sku || '',
    qty: Math.max(1, Number(item.qty) || 1),
    price: item.price || 0,
    cost: item.cost,
    hsn: item.hsn || '',
    gst: item.gst || 0,
    masterSkuId: item.masterSkuId || null,
    skuMappingId: item.skuMappingId || null,
    imageUrl: item.imageUrl || item.image || productImageUrl(item.sku, item.name),
    fulfilmentSource: item.fulfilmentSource || item.source || order?.fulfilmentSource || 'Offline',
    locationId: item.locationId || '',
  };
}

function isMixedFulfilment(order) {
  const sources = new Set();
  (order.items || []).forEach((item) => sources.add(item.fulfilmentSource || order.fulfilmentSource || 'Offline'));
  (order.subOrders || []).forEach((sub) => {
    if (sub.fulfilmentSource) sources.add(sub.fulfilmentSource);
  });
  return sources.has('Offline') && sources.has('Virtual');
}

function buildSubOrders(order) {
  if (Array.isArray(order.subOrders) && order.subOrders.length) {
    return order.subOrders.map((sub, idx) => {
      const vendor = vendorContact(sub.assignedVendor || order.assignedVendor || order.shopifyVendor, sub);
      const matchedItem = (order.items || []).find((item) => item.sku === sub.sku);
      return {
        id: sub.id || `${masterOrderBase(order.id || order.orderNo)}-${idx + 1}`,
        index: sub.index || idx + 1,
        sku: sub.sku,
        title: sub.title || sub.name || sub.product || '',
        imageUrl: sub.imageUrl || matchedItem?.imageUrl || matchedItem?.image || productImageUrl(sub.sku, sub.title || sub.name),
        qty: 1,
        price: sub.price ?? 0,
        ...vendor,
        assignedDate: sub.assignedDate || (vendor.assignedVendor ? String(order.createdAt || '').slice(0, 10) : ''),
        dispatchDate: sub.dispatchDate || '',
        deliveryStatus: sub.deliveryStatus || deliveryStatusFor(sub.status || order.status),
        status: sub.status || order.status,
        address: sub.address || order.address || order.city || '',
        customer: sub.customer || order.customer || '',
        fulfilmentSource: sub.fulfilmentSource || matchedItem?.fulfilmentSource || order.fulfilmentSource || 'Offline',
      };
    });
  }

  const rows = [];
  let index = 0;
  (order.items || []).forEach((item) => {
    const qty = Math.max(1, Number(item.qty) || 1);
    const vendorName = item.assignedVendor || order.assignedVendor || order.shopifyVendor || '';
    for (let i = 0; i < qty; i += 1) {
      index += 1;
      const vendor = vendorContact(vendorName);
      rows.push({
        id: `${masterOrderBase(order.id || order.orderNo)}-${index}`,
        index,
        sku: item.sku,
        masterSkuId: item.masterSkuId || null,
        title: item.name || item.title || '',
        imageUrl: item.imageUrl || item.image || productImageUrl(item.sku, item.name),
        qty: 1,
        price: item.price || 0,
        ...vendor,
        assignedDate: vendor.assignedVendor ? String(order.createdAt || '').slice(0, 10) : '',
        dispatchDate: '',
        deliveryStatus: deliveryStatusFor(order.status),
        status: order.status,
        address: order.address || order.city || '',
        customer: order.customer || '',
        fulfilmentSource: item.fulfilmentSource || order.fulfilmentSource || 'Offline',
      });
    }
  });
  return rows;
}

function withSubOrders(order) {
  const items = (order.items || []).map((item) => enrichItem(item, order));
  const subOrders = buildSubOrders({ ...order, items });
  const assigned = [...new Set(subOrders.map((row) => row.assignedVendor).filter(Boolean))];
  const mixed = isMixedFulfilment({ ...order, items, subOrders });
  return {
    ...order,
    items,
    subOrders,
    fulfilmentSource: mixed ? 'Mixed' : order.fulfilmentSource || 'Offline',
    assignedVendor: assigned.length === 1 ? assigned[0] : assigned.join(', ') || order.assignedVendor || '',
    subOrderIndexMap: Object.fromEntries(subOrders.map((row) => [String(row.index), row.id])),
  };
}

function findOrderMatch(orders, rawId) {
  const id = decodeURIComponent(String(rawId || ''));
  return orders.find((order) => (
    order.id === id
    || order.orderNo === id
    || (order.subOrders || []).some((sub) => sub.id === id)
  )) || null;
}

function photoHtml(name, src, size = 40) {
  if (/^https?:\/\//i.test(String(src || ''))) {
    return `<img src="${escapeHtml(src)}" alt="" width="${size}" height="${size}" style="object-fit:cover;border-radius:8px" />`;
  }
  const letter = escapeHtml(String(name || '?').charAt(0).toUpperCase());
  return `<div style="width:${size}px;height:${size}px;border-radius:8px;background:#0f766e;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">${letter}</div>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function labelHtml(order, subOrderId) {
  const lines = subOrderId
    ? (order.subOrders || []).filter((sub) => sub.id === subOrderId)
    : (order.subOrders || []);
  const awb = order.awb || 'AWB pending';
  const items = lines.map((sub) => `
    <tr>
      <td>${photoHtml(sub.title || sub.sku, sub.imageUrl, 48)}</td>
      <td>${escapeHtml(sub.title)}<br/><small>${escapeHtml(sub.sku)} · ${escapeHtml(sub.id)}</small></td>
      <td>1</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Label ${escapeHtml(order.id || order.orderNo)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 24px; color: #111; }
    .box { border: 2px solid #111; padding: 20px; max-width: 420px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    td { padding: 6px 0; vertical-align: middle; }
    .awb { font-size: 22px; letter-spacing: 0.12em; font-weight: 700; margin: 12px 0; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <div class="box">
    <h1>OMSKing shipping label</h1>
    <div>Master order <strong>${escapeHtml(order.id || order.orderNo)}</strong></div>
    <div class="awb">${escapeHtml(awb)}</div>
    <div>${escapeHtml(order.customer)}<br/>${escapeHtml(order.address || order.city)}</div>
    <div style="margin-top:8px">${escapeHtml(order.courier || 'Courier pending')} · ${escapeHtml(order.phone || '')}</div>
    <table>${items}</table>
  </div>
</body>
</html>`;
}

function invoiceHtml(order, { warehouseState = '', kind = 'invoice' } = {}) {
  const { invoiceNumber, creditNoteNumber, lineTax, shipToState } = require('../services/finance.service');
  const invoiceNo = kind === 'credit'
    ? creditNoteNumber(order)
    : (order.invoiceNo || invoiceNumber(order));
  const ship = shipToState(order);
  const rows = (order.items || []).map((item) => {
    const tax = lineTax(item, { warehouseState, shipState: ship });
    return `
    <tr>
      <td>${photoHtml(item.name || item.sku, item.imageUrl)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.sku)}</td>
      <td>${escapeHtml(item.hsn || '')}</td>
      <td>${item.qty}</td>
      <td>${tax.taxable.toFixed(2)}</td>
      <td>${tax.cgst.toFixed(2)}</td>
      <td>${tax.sgst.toFixed(2)}</td>
      <td>${tax.igst.toFixed(2)}</td>
      <td>${tax.gross.toFixed(2)}</td>
    </tr>`;
  }).join('');
  const title = kind === 'credit' ? `Credit note ${invoiceNo}` : `Tax invoice ${invoiceNo}`;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 32px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>Order ${escapeHtml(order.id || order.orderNo)} · ${escapeHtml(order.customer)} · ${escapeHtml(order.address || '')}</p>
  <p>Warehouse ${escapeHtml(warehouseState || '—')} · Ship-to ${escapeHtml(ship || '—')}</p>
  <table>
    <thead><tr><th></th><th>Item</th><th>SKU</th><th>HSN</th><th>Qty</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top:16px;font-weight:700">Total ₹${Number(order.total || 0).toLocaleString('en-IN')}</p>
</body>
</html>`;
}

module.exports = {
  masterOrderBase,
  productImageUrl,
  deliveryStatusFor,
  vendorContact,
  buildSubOrders,
  withSubOrders,
  isMixedFulfilment,
  findOrderMatch,
  escapeHtml,
  labelHtml,
  invoiceHtml,
};
