/** Drop a list response that started under a different company or an older session. */
export function sameCompanySnapshot(started, current) {
  if (!started || !current) return false;
  return started.generation === current.generation
    && String(started.tenantId || '') === String(current.tenantId || '');
}

export function activeTenantId() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').tenantId || '';
  } catch {
    return '';
  }
}
