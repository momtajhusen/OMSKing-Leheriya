export const BACKUP_LAST_KEY = 'oms-db-backup-last';
export const BACKUP_AUTO_KEY = 'oms-db-backup-auto';
export const BACKUP_LOCK_KEY = 'oms-db-backup-running';
export const BACKUP_SAVED_KEY = 'oms-db-backup-saved';
export const EVENING_HOUR = 18;
const DAY = 24 * 60 * 60 * 1000;
const LOCK_MS = 5 * 60 * 1000;

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function backupDue({ lastAt, now = new Date(), auto = true, eveningHour = EVENING_HOUR } = {}) {
  if (!auto) return false;
  const last = lastAt ? new Date(lastAt) : null;
  if (!last || Number.isNaN(last.getTime())) return true;
  if (sameDay(last, now)) return false;
  if (now.getTime() - last.getTime() >= DAY) return true;
  return now.getHours() >= eveningHour;
}

export function nextAutoBackup({ lastAt, now = new Date(), auto = true, eveningHour = EVENING_HOUR } = {}) {
  if (!auto) return null;
  if (backupDue({ lastAt, now, auto, eveningHour })) return { now: true, at: now };
  const last = new Date(lastAt);
  const day = new Date(now);
  if (sameDay(last, now)) day.setDate(day.getDate() + 1);
  day.setHours(eveningHour, 0, 0, 0);
  const catchUp = new Date(last.getTime() + DAY);
  return { now: false, at: catchUp < day ? catchUp : day };
}

export function nextAutoText(next, now = new Date()) {
  if (!next) return 'Off on this computer';
  if (next.now) return 'Due now — runs while OMSKing is open';
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = next.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay(next.at, now)) return `Today, ${time}`;
  if (sameDay(next.at, tomorrow)) return `Tomorrow, ${time}`;
  return next.at.toLocaleString();
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '—';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function savedHere(store = globalThis.localStorage) {
  try { return new Set(JSON.parse(store?.getItem(BACKUP_SAVED_KEY) || '[]')); } catch { return new Set(); }
}

function rememberSaved(name, store) {
  const list = [name, ...[...savedHere(store)].filter((item) => item !== name)].slice(0, 30);
  store?.setItem(BACKUP_SAVED_KEY, JSON.stringify(list));
}

export function driveText(status, reason = '') {
  if (status === 'uploaded') return 'Also saved to Google Drive.';
  if (status === 'failed') return `Google Drive upload failed${reason ? `: ${reason}` : ''}.`;
  return 'Google Drive is not connected.';
}

export function readBackupPrefs(store = globalThis.localStorage) {
  return {
    lastAt: store?.getItem(BACKUP_LAST_KEY) || '',
    auto: store?.getItem(BACKUP_AUTO_KEY) !== 'off',
  };
}

export function takeBackupLock(store = globalThis.localStorage, now = Date.now()) {
  const held = Number(store?.getItem(BACKUP_LOCK_KEY) || 0);
  if (held && now - held < LOCK_MS) return false;
  store?.setItem(BACKUP_LOCK_KEY, String(now));
  return true;
}

async function blobMessage(err, fallback) {
  const data = err?.response?.data;
  if (data && typeof data.text === 'function') {
    try { return JSON.parse(await data.text()).message || fallback; } catch { return fallback; }
  }
  return err?.response?.data?.message || fallback;
}

export async function downloadBackup(api, { trigger = 'manual', store = globalThis.localStorage } = {}) {
  try {
    const res = await api.post('/tenants/ops/backup', null, { params: { trigger }, responseType: 'blob', timeout: 10 * 60 * 1000 });
    const name = res.headers['x-backup-name'] || 'omsking-backup.archive.gz';
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    const at = new Date().toISOString();
    store?.setItem(BACKUP_LAST_KEY, at);
    rememberSaved(name, store);
    return { name, at, size: res.data.size, drive: res.headers['x-backup-drive'] || 'not_connected', driveReason: res.headers['x-backup-drive-reason'] || '' };
  } finally {
    store?.removeItem(BACKUP_LOCK_KEY);
  }
}

export { blobMessage };
