/** Last default view of a list page — memory + sessionStorage so reopen paints instantly. */
const store = new Map();
const PREFIX = 'oms.page.v1:';

export function pageSession(storage = globalThis.localStorage) {
  try {
    const user = JSON.parse(storage?.getItem('user') || '{}') || {};
    return `${user.id || user._id || ''}|${user.tenantId || ''}`;
  } catch {
    return '|';
  }
}

function fullKey(name, session = pageSession()) {
  return `${session}|${name}`;
}

function readSession(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

export function cachedPage(name, session = pageSession()) {
  const key = fullKey(name, session);
  if (store.has(key)) return store.get(key);
  const fromSession = readSession(key);
  if (fromSession != null) {
    store.set(key, fromSession);
    return fromSession;
  }
  return null;
}

export function rememberPage(name, value, session = pageSession()) {
  const key = fullKey(name, session);
  store.set(key, value);
  writeSession(key, value);
  return value;
}
