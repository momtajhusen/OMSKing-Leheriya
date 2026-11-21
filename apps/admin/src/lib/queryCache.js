/**
 * In-memory + sessionStorage SWR cache so page opens paint instantly
 * with the last real response while a fresh request runs in the background.
 */

const mem = new Map();
const PREFIX = 'oms.qc.v1:';

function storageKey(key) {
  return `${PREFIX}${key}`;
}

function readSession(key) {
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(key, entry) {
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // Quota / private mode — memory cache still works.
  }
}

export function cacheKey(parts) {
  return (Array.isArray(parts) ? parts : [parts])
    .map((part) => (part == null ? '' : String(part)))
    .join('|');
}

export function peekQuery(key) {
  if (!key) return null;
  if (mem.has(key)) return mem.get(key);
  const fromSession = readSession(key);
  if (fromSession) {
    mem.set(key, fromSession);
    return fromSession;
  }
  return null;
}

export function putQuery(key, data) {
  if (!key) return null;
  const entry = { data, at: Date.now() };
  mem.set(key, entry);
  writeSession(key, entry);
  return entry;
}

export function isFresh(entry, ttlMs = 45_000) {
  if (!entry?.at) return false;
  return Date.now() - entry.at < ttlMs;
}

export function clearQuery(prefix = '') {
  for (const key of [...mem.keys()]) {
    if (!prefix || key.startsWith(prefix)) mem.delete(key);
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(PREFIX) && (!prefix || key.slice(PREFIX.length).startsWith(prefix))) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
}
