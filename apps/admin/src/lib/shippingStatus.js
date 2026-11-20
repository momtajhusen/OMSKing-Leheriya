export function trackingOf(order) {
  return order.awb || (order.channelLines || []).find((line) => line.trackingNumber)?.trackingNumber || '';
}

function isCourierRto(order) {
  const codes = `${order.channelStatus || ''} ${(order.channelLines || []).map((line) => line.status).join(' ')}`.toUpperCase();
  return codes.includes('RTO');
}

function pickedUp(order) {
  return Boolean(order.pickedUpAt || order.trackingScan?.status || order.trackingScan?.deliveryStatus);
}

/**
 * Shipping tab of an order. A parcel OMSKing labelled stays in Label generated until it is put on a handover
 * manifest (Ready to hand over), and leaves both once the courier scans it or it is marked dispatched.
 * Booking a Shopify label sets the order to Dispatched, so the status alone cannot tell this.
 */
export function shipmentStatus(order) {
  if (isCourierRto(order)) return 'RTO';
  if (order.reversePickup?.returnId) return 'Exception';
  if (order.status === 'Delivered') return 'Delivered';
  if (order.labelGeneratedAt && trackingOf(order) && !pickedUp(order)) return order.handoverAt ? 'Ready' : 'Label generated';
  if (order.status === 'Dispatched') return 'In Transit';
  if (trackingOf(order)) return 'Ready';
  return 'Label Pending';
}

/** Parcels that can go on a handover manifest: labelled by OMSKing, not on a manifest yet, not picked up. */
export function canHandOver(row) {
  return row?.shipStatus === 'Label generated' && !row.handoverAt;
}

export const MANIFEST_COLUMNS = ['S.No', 'Manifest no', 'Date', 'Courier', 'Pickup warehouse', 'Order no', 'OMS order no', 'Channel', 'AWB', 'Customer', 'City', 'Pincode', 'Payment', 'COD amount', 'Qty', 'Weight (kg)'];

/** CSV for a saved handover manifest; Order no is the channel/Shopify id used on courier portals. */
export function manifestFile(manifest) {
  const rows = (manifest?.rows || []).map((row, index) => [
    index + 1, manifest.manifestNo, manifest.day, manifest.courier, manifest.warehouseCode || '',
    String(row.channelOrderNo || '').replace(/^#/, '') || row.orderNo || '',
    row.orderNo || '',
    row.channel, row.awb, row.customer, row.city, row.pincode || '', row.paymentMode, row.codAmount || 0, row.qty || 0, row.weightKg || 0,
  ]);
  return { name: `${manifest?.manifestNo || 'manifest'}.csv`, header: MANIFEST_COLUMNS, rows };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function manifestPrintDay(manifest) {
  const raw = String(manifest?.day || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    return `${Number(d)} ${months[Number(m) - 1] || ''} ${y}`.replace(/\s+/g, ' ').trim();
  }
  const when = manifest?.pickupAt ? new Date(manifest.pickupAt) : new Date();
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(when).toUpperCase();
}

/** Printable HTML: one courier manifest with pickup id + Shopify order + AWB rows. */
export function manifestPrintHtml(manifest) {
  const courier = String(manifest?.courier || 'Courier').toUpperCase();
  const pickupId = String(manifest?.pickupId || '').trim() || 'PENDING';
  const pickupTime = String(manifest?.pickupTime || '').trim() || '—';
  const rows = (manifest?.rows || []).map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.channelOrderNo || row.orderNo || '')}</td>
      <td>${escapeHtml(row.awb || '')}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Manifest ${escapeHtml(courier)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px}
  .head{background:#d9f2d0;padding:12px 16px;border:1px solid #9ccc88}
  .title{text-align:center;font-size:20px;font-weight:700;letter-spacing:.04em;margin:0 0 10px}
  .meta{display:flex;justify-content:space-between;gap:12px;font-size:13px;font-weight:600}
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
  th,td{border:1px solid #333;padding:8px;text-align:left}
  th{background:#f3f3f3}
  @media print{body{margin:12px}}
</style></head><body>
  <div class="head">
    <div class="title">MANIFEST : ${escapeHtml(courier)}</div>
    <div class="meta">
      <span>PICKUP ID: ${escapeHtml(pickupId)}</span>
      <span>PICKUP DATE: ${escapeHtml(manifestPrintDay(manifest))}</span>
      <span>PICKUP TIME: ${escapeHtml(pickupTime)}</span>
    </div>
  </div>
  <table>
    <thead><tr><th>S.NO.</th><th>SHOPIFY ORDER ID</th><th>AWB NUMBER</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No parcels</td></tr>'}</tbody>
  </table>
</body></html>`;
}

/** Amazon label button on the order page: 'make' an Easy Ship label, 'print' the stored one, or null (not Amazon / nothing to do). */
export function amazonLabelStep(order) {
  if (order?.channel !== 'Amazon') return null;
  if (['Cancelled', 'Delivered', 'Returned'].includes(order.status)) return null;
  // Amazon often maps to Dispatched before OMS books Easy Ship — still offer Make label until AWB exists.
  if (order.labelGeneratedAt && trackingOf(order)) return 'print';
  if (trackingOf(order)) return 'print';
  return 'make';
}

const DEFAULT_COURIER = { code: 'delhivery', name: 'Delhivery', api: true };

/** Couriers offered at label time (this company's enabled ones, Delhivery first) and the picked one; unknown codes fall back to Delhivery. */
export function courierChoice(couriers, code) {
  const list = couriers?.length ? couriers : [DEFAULT_COURIER];
  return { list, picked: list.find((courier) => courier.code === code) || list[0] };
}

/** Courier dropdown label — name only (rates stay under the field via rateNote). */
export function courierOptionText(courier) {
  return String(courier?.name || courier?.code || 'Courier').trim() || 'Courier';
}

/** One line under the dropdown explaining the picked courier's estimate. */
export function rateNote(courier, pack) {
  if (!pack?.weightGrams) return 'Package weight is missing, so no rate. Add item weights or the default package in Settings.';
  const est = courier.estimate;
  if (!est) return `No rate saved for ${courier.name}. Add its ₹ per 0.5 kg in Settings › Couriers.`;
  return `Estimated ₹${est.amount} for ${est.chargeableKg} kg (${est.slabs} × 0.5 kg). Rate card from Settings › Couriers; the courier bills the final amount.`;
}

/** Label request body: Delhivery is booked by API ({}); any other courier sends its code and the AWB from its portal. */
export function labelRequest(picked, awb) {
  if (picked.api) return { body: picked.code === 'delhivery' ? {} : { courier: picked.code } };
  const tracking = String(awb || '').trim();
  if (!tracking) return { error: `Enter the ${picked.name} AWB` };
  return { body: { courier: picked.code, awb: tracking } };
}

/** Normalize courier names/codes so Shipping history filters match order.courier display names. */
export function courierKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'blue dart' || raw === 'bluedart') return 'bluedart';
  if (raw === 'shree maruti' || raw === 'maruti' || raw === 'shree-maruti') return 'shree-maruti';
  if (raw === 'amazon shipping' || raw === 'amazon-shipping') return 'amazon-shipping';
  if (raw.startsWith('delhivery')) return 'delhivery';
  return raw.replace(/\s+/g, '-');
}

/** One Super-Admin desk card: how this courier books and the plain-language note from readiness. */
export function courierDeskCard(courier) {
  const api = Boolean(courier?.api);
  return {
    code: courier?.code || '',
    name: courier?.name || 'Courier',
    api,
    bookHow: courier?.bookHow || (api ? 'api' : 'awb'),
    badge: api ? 'API book + label' : 'Enter AWB',
    note: courier?.note || (api ? 'API booking is on.' : 'Enter the AWB from the courier portal.'),
  };
}

/** True when this shipment belongs to the selected courier filter (or filter is all). */
export function shipmentMatchesCourier(order, courierFilter) {
  if (!courierFilter || courierFilter === 'all') return true;
  return courierKey(order?.courier) === courierKey(courierFilter)
    || courierKey(order?.courierCode) === courierKey(courierFilter);
}

const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

/** "Pickup 6 Nov, 10:00 am – 2:00 pm" for an Easy Ship package; '' when there is none. */
export function pickupSlotText(order) {
  const slot = order?.easyShip;
  if (!slot?.slotStart) return '';
  const start = new Date(slot.slotStart);
  const end = slot.slotEnd ? ` – ${TIME.format(new Date(slot.slotEnd))}` : '';
  return `${slot.handover === 'DROPOFF' ? 'Drop-off' : 'Pickup'} ${DAY.format(start)}, ${TIME.format(start)}${end}`;
}

/** Selected rows that still need a label: Shopify goes to the label job, Amazon to Easy Ship. */
export function splitLabelOrders(rows, selectedIds) {
  const picked = rows.filter((row) => selectedIds.includes(row.id) && row.shipStatus === 'Label Pending');
  return {
    shopify: picked.filter((row) => !row.marketplace).map((row) => row.id),
    amazon: picked.filter((row) => row.channel === 'Amazon').map((row) => row.id),
  };
}
