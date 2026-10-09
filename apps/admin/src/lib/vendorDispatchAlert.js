export const DISPATCH_SLA_DAYS = 7;
export const DISPATCH_URGENT_MESSAGE = 'Please dispatch this item urgently';

const SHIPPED = new Set(['Dispatched', 'Delivered', 'Rejected']);

function dayStart(value) {
  const date = value instanceof Date ? new Date(value) : new Date(`${String(value).slice(0, 10)}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function daysSinceAssigned(row, now = new Date()) {
  if (!row?.assignedDate) return 0;
  const start = dayStart(row.assignedDate);
  const today = dayStart(now);
  return Math.floor((today.getTime() - start.getTime()) / 86400000);
}

export function isDispatchOverdue(row, now = new Date()) {
  if (!row || SHIPPED.has(row.status)) return false;
  if (row.dispatchedDate) return false;
  return daysSinceAssigned(row, now) >= DISPATCH_SLA_DAYS;
}
