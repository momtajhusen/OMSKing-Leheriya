import { eventLabel } from './reportUpdates.js';

export const MAX_FILE_MB = { image: 10, audio: 16, video: 50 };

const KIND_LABEL = { image: 'Photo', video: 'Video', audio: 'Voice message' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Server rows replace local copies by id; pending (still uploading) bubbles stay last. */
export function mergeMessages(current, incoming) {
  const byId = new Map();
  current.filter((m) => !m.pending).forEach((m) => byId.set(m.id, m));
  incoming.forEach((m) => byId.set(m.id, { ...byId.get(m.id), ...m }));
  const settled = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...settled, ...current.filter((m) => m.pending)];
}

/** Height of the shortest bubble (one line of text) plus its gap; a page is sized to what fits on screen. */
const MIN_ROW_PX = 40;
const PAGE_MIN = 8;
const PAGE_MAX = 50;

export function pageSizeFor(viewportPx) {
  const rows = Math.ceil((Number(viewportPx) || 0) / MIN_ROW_PX) + 2;
  return Math.min(PAGE_MAX, Math.max(PAGE_MIN, rows));
}

/** A poll only brings the newest page; if none of it is already loaded, messages in between are missing. */
export function hasGap(current, rows, hasMore) {
  if (!hasMore || !rows.length) return false;
  const ids = new Set(current.filter((m) => !m.pending).map((m) => m.id));
  if (!ids.size) return false;
  return !rows.some((m) => ids.has(m.id));
}

function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function dayLabel(value, now = new Date()) {
  const day = startOfDay(value);
  const diff = Math.round((startOfDay(now) - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return WEEKDAYS[day.getDay()];
  return `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
}

export function timeLabel(value) {
  const d = new Date(value);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

export function formatDuration(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function fileKind(file) {
  const family = String(file?.type || '').split('/')[0];
  return MAX_FILE_MB[family] ? family : null;
}

/** Photos and videos on the clipboard: a Ctrl+V screenshot, or files copied in Finder / Explorer. */
export function clipboardFiles(clipboardData) {
  if (!clipboardData) return [];
  const fromItems = Array.from(clipboardData.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file) => file && fileKind(file));
  if (fromItems.length) return fromItems;
  return Array.from(clipboardData.files || []).filter((file) => fileKind(file));
}

export function messagePreview(message) {
  if (message?.deleted) return 'This message was deleted';
  if (message?.event) return eventLabel(message.event, message.senderName, message.mine);
  if (message?.text) return message.text;
  return KIND_LABEL[message?.attachment?.kind || message?.kind] || '';
}

export function recorderMime(Recorder = globalThis.MediaRecorder) {
  if (!Recorder?.isTypeSupported) return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find((type) => Recorder.isTypeSupported(type)) || '';
}

/** The developer's own machine: Developer Support there goes to the live API, and only there can the developer mark work. */
export function isLocalApp(loc = globalThis.location) {
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc?.hostname || '');
}

/** Media links are API paths; in production the API lives on another host than the admin app. */
export function mediaSrc(url, baseURL = '') {
  const value = String(url || '');
  if (!value || /^(https?:|blob:|data:)/i.test(value)) return value;
  const base = String(baseURL || '');
  if (!/^https?:\/\//i.test(base)) return value;
  return `${new URL(base).origin}${value}`;
}

export function fileSizeLabel(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
