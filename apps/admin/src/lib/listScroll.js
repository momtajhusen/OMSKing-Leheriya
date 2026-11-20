const ORDERS_LIST_SCROLL_KEY = 'oms-orders-list-scroll';

export function readMainScrollTop() {
  const main = typeof document !== 'undefined' ? document.querySelector('main') : null;
  return main ? main.scrollTop : 0;
}

export function writeMainScrollTop(y) {
  const main = typeof document !== 'undefined' ? document.querySelector('main') : null;
  if (main) main.scrollTop = y;
}

/** Remember where the orders list was before opening an order. */
export function saveOrdersListScroll() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(ORDERS_LIST_SCROLL_KEY, String(readMainScrollTop()));
}

export function peekOrdersListScroll() {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(ORDERS_LIST_SCROLL_KEY);
  if (raw == null) return null;
  const y = Number(raw);
  return Number.isFinite(y) ? y : null;
}

export function clearOrdersListScroll() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(ORDERS_LIST_SCROLL_KEY);
}
