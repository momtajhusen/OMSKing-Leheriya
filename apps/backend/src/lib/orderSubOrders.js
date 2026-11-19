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
  const price = Number(item.price) || 0;
  const discount = Math.max(0, Number(item.discount) || 0);
  const finalPrice = Number(item.finalPrice) > 0
    ? Number(item.finalPrice)
    : Math.round(Math.max(0, price - discount) * 100) / 100;
  return {
    name: item.name || item.title || '',
    sku: item.sku || '',
    qty: Math.max(1, Number(item.qty) || 1),
    price,
    discount,
    finalPrice,
    cost: item.cost,
    hsn: item.hsn || '',
    gst: item.gst || 0,
    masterSkuId: item.masterSkuId || null,
    skuMappingId: item.skuMappingId || null,
    imageUrl: item.imageUrl || item.image || productImageUrl(item.sku, item.name),
    vendor: item.vendor || '',
    fulfilmentSource: item.fulfilmentSource || item.source || order?.fulfilmentSource || 'Offline',
    locationId: item.locationId || '',
    channelVariantId: item.channelVariantId || '',
    channelProductId: item.channelProductId || '',
    priceFromMrp: Boolean(item.priceFromMrp),
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
  return String(order.brandName || order.shopName || order.tenantName || 'Leheriya').trim() || 'Leheriya';
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
    gstin: String(order.gstin || order.companyGstin || '').trim() || '—',
    shipTo: [
      escapeHtml(order.customer || 'Customer'),
      escapeHtml([order.address, city, order.shipState, 'India', pin].filter(Boolean).join(', ')),
    ].join('<br/>'),
    taxLines,
    totals,
  };
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
        <div>
          <div class="brand-mark">${escapeHtml(model.brand)}</div>
          <div class="brand-sub">${escapeHtml(model.brand)}</div>
        </div>
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
        <div><b>${escapeHtml(model.brand)}</b></div>
        <div>${escapeHtml(returnBlock(order))}</div>
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
    body { margin: 0; padding: 0; color: #111; background: #fff;
      font-family: Arial, Helvetica, sans-serif; }
    .page { width: 4in; min-height: 6in; padding: 0.12in; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .sheet { width: 100%; border: 1.5px solid #111; }
    .row { display: flex; border-bottom: 1.5px solid #111; }
    .row:last-child { border-bottom: 0; }
    .cell { padding: 8px 10px; }
    .split { border-left: 1.5px solid #111; }
    .brand { flex: 0 0 38%; display: flex; align-items: center; justify-content: center; }
    .brand-mark { font-family: Georgia, "Times New Roman", serif; font-size: 24px; font-style: italic;
      font-weight: 700; letter-spacing: 0.02em; }
    .brand-sub { font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 800;
      font-style: normal; margin-top: 2px; letter-spacing: 0.04em; }
    .ship { flex: 1; font-size: 12px; line-height: 1.35; }
    .ship .k { font-weight: 700; margin-bottom: 4px; }
    .track { flex-direction: column; align-items: stretch; text-align: center; padding: 8px 10px 6px; }
    .track .who { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
    .barcode { display: inline-block; max-width: 100%; height: 48px; }
    .pay { flex: 0 0 34%; display: flex; align-items: center; justify-content: center;
      font-size: 24px; font-weight: 900; letter-spacing: 0.02em; }
    .meta { flex: 1; font-size: 11px; line-height: 1.45; }
    .meta b { font-weight: 700; }
    .oid { text-align: center; font-size: 14px; font-weight: 800; padding: 7px 10px; }
    table.items { width: 100%; border-collapse: collapse; font-size: 11px; }
    table.items th, table.items td { border-top: 1px solid #111; padding: 5px 6px; vertical-align: top; }
    table.items th { background: #f3f3f3; text-align: left; font-size: 10px; }
    table.items .c { text-align: center; width: 28px; }
    table.items .r { text-align: right; width: 52px; }
    table.items .sku { font-size: 10px; color: #444; }
    .ret { font-size: 11px; line-height: 1.4; }
    .ret b { font-weight: 700; }
    @media print {
      body { padding: 0; }
      .page { width: 4in; height: 6in; min-height: 0; padding: 0.1in; overflow: hidden; }
      @page { size: 4in 6in; margin: 0; }
    }
`;

/**
 * One packing-slip label for every courier (Delhivery / Blue Dart / Shree Maruti / …).
 * Layout: brand + ship-to, courier AWB barcode, PREPAID|COD + meta, order items, return + GSTIN.
 * Pass { withInvoice: true } for Shipway-style Label + Invoice on two 4×6 pages.
 */
function labelHtml(order, subOrderId, { withInvoice = false } = {}) {
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

function labelInvoiceHtml(order, subOrderId) {
  return labelHtml(order, subOrderId, { withInvoice: true });
}

function invoiceHtml(order, { warehouseState = '', kind = 'invoice' } = {}) {
  const { invoiceNumber, creditNoteNumber, invoiceTotals } = require('../services/finance.service');
  const invoiceNo = kind === 'credit'
    ? creditNoteNumber(order)
    : (order.invoiceNo || invoiceNumber(order));
  const { lines, totals, shipState: ship } = invoiceTotals(order, { warehouseState });
  const rows = lines.map(({ item, tax }) => {
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
  <p>Order ${escapeHtml(String(order.channelOrderNo || '').replace(/^#/, '') || order.id || order.orderNo)} · ${escapeHtml(order.customer)} · ${escapeHtml(order.address || '')}</p>
  <p>Warehouse ${escapeHtml(warehouseState || '—')} · Ship-to ${escapeHtml(ship || '—')}</p>
  <table>
    <thead><tr><th></th><th>Item</th><th>SKU</th><th>HSN</th><th>Qty</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top:16px;font-weight:700">Total ₹${totals.gross.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
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
  labelInvoiceHtml,
  invoiceHtml,
};
