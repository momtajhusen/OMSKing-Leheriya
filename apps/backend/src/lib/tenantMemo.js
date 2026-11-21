/**
 * Short in-process memo for heavy read endpoints.
 * TTL is short so writes stay correct without a full invalidation bus.
 */

const bags = new Map();

function tenantMemo(key, ttlMs, compute) {
  const now = Date.now();
  const hit = bags.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = compute();
  if (value && typeof value.then === 'function') {
    const pending = value.then(
      (resolved) => {
        bags.set(key, { at: Date.now(), value: Promise.resolve(resolved) });
        return resolved;
      },
      (err) => {
        bags.delete(key);
        throw err;
      },
    );
    bags.set(key, { at: now, value: pending });
    return pending;
  }
  bags.set(key, { at: now, value });
  return value;
}

function bustTenantMemo(prefix = '') {
  for (const key of [...bags.keys()]) {
    if (!prefix || key.startsWith(prefix)) bags.delete(key);
  }
}

module.exports = { tenantMemo, bustTenantMemo };
