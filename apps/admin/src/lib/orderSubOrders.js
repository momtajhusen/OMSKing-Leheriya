export function masterOrderBase(orderNo) {
  return String(orderNo || '').replace(/-LEH$/i, '');
}

export function deliveryStatusFor(status) {
  if (status === 'Delivered') return 'Delivered';
  if (status === 'Dispatched') return 'In transit';
  if (['Processing', 'Packed', 'Ready to Ship'].includes(status)) return 'Processing';
  if (status === 'Cancelled') return 'Cancelled';
  return 'Pending';
}

export function vendorContact(name, extra = {}) {
  return {
    assignedVendor: name || '',
    vendorPhone: extra.vendorPhone || extra.phone || '',
    vendorEmail: extra.vendorEmail || extra.email || '',
    vendorLocation: extra.vendorLocation || extra.location || '',
  };
}

function enrichItem(item, order) {
  return {
    ...item,
    name: item.name || item.title || '',
    qty: Math.max(1, Number(item.qty) || 1),
    imageUrl: item.imageUrl || item.image || '',
    fulfilmentSource: item.fulfilmentSource || item.source || order?.fulfilmentSource || 'Offline',
  };
}

export function itemFulfilmentSource(item, order) {
  return item?.fulfilmentSource || item?.source || order?.fulfilmentSource || 'Offline';
}

export function fulfilmentSources(order) {
  const sources = new Set();
  (order.items || []).forEach((item) => sources.add(itemFulfilmentSource(item, order)));
  (order.subOrders || []).forEach((sub) => {
    if (sub.fulfilmentSource) sources.add(sub.fulfilmentSource);
  });
  if (!sources.size && order.fulfilmentSource) sources.add(order.fulfilmentSource);
  return [...sources];
}

export function isMixedFulfilment(order) {
  const sources = fulfilmentSources(order);
  return sources.includes('Offline') && sources.includes('Virtual');
}

export function orderFulfilmentLabel(order) {
  if (isMixedFulfilment(order)) return 'Mixed';
  const sources = fulfilmentSources(order);
  if (sources.length === 1) return sources[0];
  return order.fulfilmentSource || 'Offline';
}

export function buildSubOrders(order) {
  if (Array.isArray(order.subOrders) && order.subOrders.length) {
    return order.subOrders.map((sub, idx) => {
      const vendor = vendorContact(sub.assignedVendor || order.assignedVendor || order.shopifyVendor, sub);
      const matchedItem = (order.items || []).find((item) => item.sku === sub.sku);
      return {
        ...sub,
        id: sub.id || `${masterOrderBase(order.id)}-${idx + 1}`,
        index: sub.index || idx + 1,
        title: sub.title || sub.name || sub.product || '',
        imageUrl: sub.imageUrl || '',
        qty: 1,
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
        id: `${masterOrderBase(order.id)}-${index}`,
        index,
        sku: item.sku,
        title: item.name,
        imageUrl: item.imageUrl || '',
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

export function withSubOrders(order) {
  const items = (order.items || []).map((item) => enrichItem(item, order));
  const subOrders = buildSubOrders({ ...order, items });
  const assigned = [...new Set(subOrders.map((row) => row.assignedVendor).filter(Boolean))];
  const mixed = isMixedFulfilment({ ...order, items, subOrders });
  return {
    ...order,
    items,
    subOrders,
    fulfilmentSource: mixed ? 'Mixed' : order.fulfilmentSource || fulfilmentSources({ items, subOrders, fulfilmentSource: order.fulfilmentSource })[0] || 'Offline',
    assignedVendor: assigned.length === 1 ? assigned[0] : assigned.join(', ') || order.assignedVendor || '',
    subOrderIndexMap: Object.fromEntries(subOrders.map((row) => [String(row.index), row.id])),
  };
}

export function findOrderMatch(orders, rawId) {
  const id = decodeURIComponent(String(rawId || ''));
  return orders.find((order) => (
    order.id === id
    || (order.subOrders || []).some((sub) => sub.id === id)
  )) || null;
}

export function ordersForVendor(orders, vendorName) {
  if (!vendorName) return [];
  return orders.flatMap((order) => {
    const lines = (order.subOrders || []).filter((sub) => sub.assignedVendor === vendorName);
    if (!lines.length && order.assignedVendor === vendorName) {
      return [{ ...order, line: null, displayId: order.id }];
    }
    return lines.map((line) => ({
      ...order,
      line,
      displayId: line.id,
    }));
  });
}
