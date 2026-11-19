import { lazy as reactLazy } from 'react';

const RELOAD_KEY = 'oms-chunk-reload';
const RELOAD_COOLDOWN_MS = 15_000;

export function isChunkLoadError(err) {
  const msg = String(err?.message || err || '');
  return /Failed to fetch dynamically imported module|Loading chunk [\d]+ failed|Importing a module script failed|error loading dynamically imported module/i.test(msg);
}

export function reloadOnceForChunk() {
  if (typeof window === 'undefined') return false;
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

/** Same as React.lazy, but one auto-reload after a deploy replaces hashed chunks. */
export function lazy(factory) {
  return reactLazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (isChunkLoadError(err) && reloadOnceForChunk()) {
        return new Promise(() => {});
      }
      throw err;
    }
  });
}
