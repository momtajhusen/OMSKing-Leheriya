/** Sub-order lines assigned to a vendor, flattened for the vendor sheet. The API already limits vendor users to their own lines. */
export function vendorLines(orders) {
  return (orders || []).flatMap((order) => (order.subOrders || [])
    .filter((sub) => sub.assignedVendor)
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
