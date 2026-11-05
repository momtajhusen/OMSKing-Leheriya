const LABEL_STATUSES = ['New', 'Pending', 'Processing', 'Packed', 'Ready to Ship'];

export function toggleId(selected, id) {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

export function togglePage(selected, pageIds) {
  const allTicked = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  if (allTicked) return selected.filter((id) => !pageIds.includes(id));
  return [...selected, ...pageIds.filter((id) => !selected.includes(id))];
}

function picked(orders, selected) {
  return orders.filter((order) => selected.includes(order.id) && !order.mappingFailed);
}

export function packableIds(orders, selected) {
  return picked(orders, selected).filter((order) => order.status === 'New').map((order) => order.id);
}

export function labelableIds(orders, selected) {
  return picked(orders, selected)
    .filter((order) => !/^(amazon|myntra)/i.test(order.channel || ''))
    .filter((order) => LABEL_STATUSES.includes(order.status) && !order.awb)
    .map((order) => order.id);
}
