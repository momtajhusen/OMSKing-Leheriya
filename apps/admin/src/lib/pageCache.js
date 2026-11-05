/** Last default view of a list page, kept in memory for this tab so reopening the page shows it while it refreshes. */
const store = new Map();

export function pageSession(storage = globalThis.localStorage) {
  try {
    const user = JSON.parse(storage?.getItem('user') || '{}') || {};
    return `${user.id || user._id || ''}|${user.tenantId || ''}`;
  } catch {
    return '|';
  }
}

export function cachedPage(name, session = pageSession()) {
  return store.get(`${session}|${name}`) ?? null;
}

export function rememberPage(name, value, session = pageSession()) {
  store.set(`${session}|${name}`, value);
  return value;
}
