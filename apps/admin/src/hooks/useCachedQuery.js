import { useCallback, useEffect, useRef, useState } from 'react';
import { cacheKey, isFresh, peekQuery, putQuery } from '../lib/queryCache';

/**
 * Stale-while-revalidate loader: show last real data instantly, refresh quietly.
 * First visit (no cache) still sets loading=true.
 */
export default function useCachedQuery(parts, fetcher, {
  enabled = true,
  ttlMs = 45_000,
  keepPrevious = true,
} = {}) {
  const key = enabled ? cacheKey(parts) : '';
  const cached = key ? peekQuery(key) : null;
  const [data, setData] = useState(() => cached?.data ?? null);
  const [loading, setLoading] = useState(() => Boolean(enabled && !cached));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const reqId = useRef(0);

  const reload = useCallback(async ({ silent } = {}) => {
    if (!key || !enabled) return null;
    const id = ++reqId.current;
    const have = peekQuery(key)?.data ?? (keepPrevious ? data : null);
    const soft = silent || have != null;
    if (soft) setRefreshing(true);
    else setLoading(true);
    try {
      const next = await fetcherRef.current();
      if (id !== reqId.current) return null;
      putQuery(key, next);
      setData(next);
      setError('');
      return next;
    } catch (err) {
      if (id !== reqId.current) return null;
      setError(err);
      if (!have) setData(null);
      throw err;
    } finally {
      if (id === reqId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [key, enabled, keepPrevious, data]);

  useEffect(() => {
    if (!key || !enabled) {
      setLoading(false);
      setRefreshing(false);
      return undefined;
    }
    const hit = peekQuery(key);
    if (hit?.data != null) {
      setData(hit.data);
      setLoading(false);
      if (isFresh(hit, ttlMs)) return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        await reload({ silent: hit?.data != null });
      } catch {
        if (!cancelled) {/* error state already set */}
      }
    })();
    return () => { cancelled = true; };
    // key/enabled/ttl drive reloads; fetcher is via ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, ttlMs]);

  return {
    data,
    loading: Boolean(loading && data == null),
    refreshing: Boolean(refreshing || (loading && data != null)),
    error,
    reload,
    cacheHit: data != null && !loading,
  };
}
