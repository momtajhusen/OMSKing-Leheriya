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

/** Settings has no product photos. Skip the catalog fetch so that screen stays responsive. */
export function pageShowsProductPhotos(pathname) {
  const path = String(pathname || '');
  if (path === '/settings' || path.startsWith('/settings/')) return false;
  if (path === '/setup' || path.startsWith('/setup/')) return false;
  if (path === '/platform/setup' || path.startsWith('/platform/setup/')) return false;
  if (path === '/vendor/settings' || path.startsWith('/vendor/settings/')) return false;
  return true;
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
    const current = get().byKey;
    let next = null;
    for (const [key, url] of pairs || []) {
      const norm = String(key || '').trim().toLowerCase();
      const photo = catalogPhoto(url);
      if (!norm || !photo) continue;
      if (catalogPhoto((next || current)[norm])) continue;
      if (!next) next = { ...current };
      next[norm] = photo;
    }
    if (next) set({ byKey: next });
  },
  clearCompany() {
    set({ byKey: {} });
  },
}));

export default useProductImageStore;
