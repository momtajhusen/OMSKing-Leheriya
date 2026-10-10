const CANCELLED = ['Cancelled', 'Canceled', 'RTO'];
const DISPATCHABLE = new Set(['Accepted', 'Ready to Dispatch']);

/** Sub-order lines for the vendor sheet. An empty name list shows nothing. */
export function vendorLines(orders, vendorNames) {
  const allow = new Set((Array.isArray(vendorNames) ? vendorNames : [])
    .map((name) => String(name).trim().toLowerCase())
    .filter(Boolean));
  return (orders || []).flatMap((order) => (order.subOrders || [])
    .filter((sub) => sub.assignedVendor && allow.has(String(sub.assignedVendor).trim().toLowerCase()))
    .map((sub) => ({
      id: sub.id,
      masterId: order.id,
      orderId: sub.id,
      vendor: sub.assignedVendor,
      product: sub.title,
      sku: sub.sku,
      qty: sub.qty || 1,
      imageUrl: sub.imageUrl,
      assignPrice: Number(sub.price) || 0,
      status: sub.vendorStatus || 'Pending Acceptance',
      rejectReason: sub.rejectReason || '',
      assignedDate: sub.assignedDate || '',
      trackingNumber: sub.trackingNumber || '',
      courier: sub.courier || '',
      dispatchedDate: sub.dispatchDate || '',
      deliveryDate: sub.deliveredDate || '',
      customerCity: order.city || '',
      channel: order.channel,
      orderStatus: order.status,
      reversePickup: order.reversePickup || null,
    })))
    .sort((a, b) => String(b.assignedDate).localeCompare(String(a.assignedDate)));
}

/** Save on an accepted line is a dispatch. A blank tracking number is refused. */
export function vendorSaveAction(row) {
  if (DISPATCHABLE.has(row?.status)) {
    if (!String(row.trackingNumber || '').trim() || !String(row.courier || '').trim()) {
      return { error: 'Tracking number and courier are required to dispatch' };
    }
    return { action: 'dispatch' };
  }
  if (row?.status === 'Dispatched' && row.deliveryDate) return { action: 'deliver' };
  return { action: 'save' };
}

/** Copy one tracking number onto every selected line. */
export function rowsWithSharedTracking(rows, selectedIds, tracking, courier) {
  const number = String(tracking || '').trim();
  const name = String(courier || '').trim();
  if (!number || !name) return { error: 'Enter the tracking number and your courier' };
  const ids = new Set(selectedIds || []);
  const picked = (rows || []).filter((row) => ids.has(row.id)).map((row) => ({
    ...row,
    trackingNumber: number,
    courier: name,
  }));
  return { picked };
}

export function vendorReturnLines(orders, vendorNames) {
  return vendorLines(orders, vendorNames)
    .filter((row) => row.reversePickup || CANCELLED.includes(row.orderStatus));
}

export function vendorCatalog(orders, vendorNames) {
  const bySku = new Map();
  vendorLines(orders, vendorNames).forEach((row) => {
    const current = bySku.get(row.sku) || {
      sku: row.sku,
      product: row.product,
      imageUrl: row.imageUrl || '',
      lines: 0,
      qty: 0,
      lastPrice: 0,
    };
    if (!current.imageUrl && row.imageUrl) current.imageUrl = row.imageUrl;
    current.lines += 1;
    current.qty += Number(row.qty) || 1;
    current.lastPrice = row.assignPrice || current.lastPrice;
    if (row.product) current.product = row.product;
    bySku.set(row.sku, current);
  });
  return [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}
