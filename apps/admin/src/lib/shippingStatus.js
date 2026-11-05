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

export const MANIFEST_COLUMNS = ['S.No', 'Manifest no', 'Date', 'Courier', 'Pickup warehouse', 'Order no', 'Channel order no', 'Channel', 'AWB', 'Customer', 'City', 'Pincode', 'Payment', 'COD amount', 'Qty', 'Weight (kg)'];

/** CSV for a saved handover manifest; the columns change once the client shares their manifest format. */
export function manifestFile(manifest) {
  const rows = (manifest?.rows || []).map((row, index) => [
    index + 1, manifest.manifestNo, manifest.day, manifest.courier, manifest.warehouseCode || '', row.orderNo, row.channelOrderNo || '',
    row.channel, row.awb, row.customer, row.city, row.pincode || '', row.paymentMode, row.codAmount || 0, row.qty || 0, row.weightKg || 0,
  ]);
  return { name: `${manifest?.manifestNo || 'manifest'}.csv`, header: MANIFEST_COLUMNS, rows };
}

/** Amazon label button on the order page: 'make' an Easy Ship label, 'print' the stored one, or null (not Amazon / nothing to do). */
export function amazonLabelStep(order) {
  if (order?.channel !== 'Amazon') return null;
  if (order.labelGeneratedAt && trackingOf(order)) return 'print';
  if (['Cancelled', 'Dispatched', 'Delivered', 'Returned'].includes(order.status)) return null;
  return 'make';
}

const DEFAULT_COURIER = { code: 'delhivery', name: 'Delhivery', api: true };

/** Couriers offered at label time (this company's enabled ones, Delhivery first) and the picked one; unknown codes fall back to Delhivery. */
export function courierChoice(couriers, code) {
  const list = couriers?.length ? couriers : [DEFAULT_COURIER];
  return { list, picked: list.find((courier) => courier.code === code) || list[0] };
}

/** "Delhivery · ₹160 (default)" / "Xpressbees · no rate (enter AWB)" for the courier dropdown. */
export function courierOptionText(courier) {
  const rate = courier.estimate ? `₹${courier.estimate.amount}` : 'no rate';
  return `${courier.name} · ${rate}${courier.api ? ' (default)' : ' (enter AWB)'}`;
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
  if (picked.api) return { body: {} };
  const tracking = String(awb || '').trim();
  if (!tracking) return { error: `Enter the ${picked.name} AWB` };
  return { body: { courier: picked.code, awb: tracking } };
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
