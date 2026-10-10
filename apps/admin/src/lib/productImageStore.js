import { create } from 'zustand';

function keep(url) {
  const value = String(url || '').trim();
  if (!value || /example\.com/i.test(value)) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('/uploads/')) return value;
  return '';
}

export function findProductImage(byKey, ...keys) {
  const map = byKey || {};
  for (const raw of keys) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) continue;
    if (map[key]) return map[key];
    if (key.length > 4 && /^[ma]/.test(key) && map[key.slice(1)]) return map[key.slice(1)];
  }
  return '';
}

const useProductImageStore = create((set, get) => ({
  byKey: {},
  remember(pairs) {
    let map = get().byKey;
    let changed = false;
    for (const [key, url] of pairs || []) {
      const norm = String(key || '').trim().toLowerCase();
      const photo = keep(url);
      if (!norm || !photo || map[norm]) continue;
      map = { ...map, [norm]: photo };
      changed = true;
    }
    if (changed) set({ byKey: map });
  },
}));

export default useProductImageStore;
