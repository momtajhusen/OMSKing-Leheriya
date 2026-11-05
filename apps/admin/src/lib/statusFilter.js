function choices(tabs) {
  return tabs.filter((tab) => tab.id !== 'all');
}

export function statusOptions(tabs, search) {
  const term = String(search || '').trim().toLowerCase();
  return choices(tabs).filter((tab) => !term || tab.label.toLowerCase().includes(term));
}

export function statusParam(selected, tabs) {
  const picked = choices(tabs).filter((tab) => selected.includes(tab.id)).map((tab) => tab.id);
  if (!picked.length || picked.length === choices(tabs).length) return 'all';
  return picked.join(',');
}

export function selectedStatuses(param, tabs) {
  if (!param || param === 'all') return [];
  const values = String(param).split(',');
  return choices(tabs).filter((tab) => values.includes(tab.id)).map((tab) => tab.id);
}

const MENU_WIDTH = 288;
const EDGE = 8;

/** Screen position of the status menu: right under its icon, kept inside the window. */
export function menuPosition(rect, viewportWidth, width = MENU_WIDTH) {
  const left = Math.max(EDGE, Math.min(rect.left, viewportWidth - width - EDGE));
  return { top: rect.bottom + 6, left };
}
