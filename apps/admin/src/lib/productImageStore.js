import { create } from 'zustand';

function isPlaceholder(url) {
  return /example\.com|picsum\.photos|via\.placeholder\.com|placehold\.co|placeholder\.com|dummyimage\.com|placekitten\.com|loremflickr\.com/i.test(url);
}

export function catalogPhoto(url) {
  const value = String(url || '').trim();
  if (!value || isPlaceholder(value)) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('/uploads/')) return value;
  return '';
}

export function findProductImage(byKey, ...keys) {
  const map = byKey || {};
  for (const raw of keys) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) continue;
    const photo = catalogPhoto(map[key]);
    if (photo) return photo;
    if (key.length > 4 && /^[ma]/.test(key)) {
      const trimmed = catalogPhoto(map[key.slice(1)]);
      if (trimmed) return trimmed;
    }
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
      const photo = catalogPhoto(url);
      if (!norm || !photo || catalogPhoto(map[norm]) === photo) continue;
      if (catalogPhoto(map[norm])) continue;
      map = { ...map, [norm]: photo };
      changed = true;
    }
    if (changed) set({ byKey: map });
  },
  clearCompany() {
    set({ byKey: {} });
  },
}));

export default useProductImageStore;
