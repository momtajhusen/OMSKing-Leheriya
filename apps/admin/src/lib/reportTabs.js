import { messagePreview } from './reportChat.js';
import { eventLabel, openStatus, pickSummary, STAGE_META } from './reportUpdates.js';

export const REPORT_TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'updates', label: 'Updates' },
  { id: 'history', label: 'History' },
];

export const ITEM_STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'progress', label: 'In progress' },
  { id: 'waiting', label: 'Waiting for client' },
  { id: 'input', label: 'Needs input' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'complete', label: 'Complete' },
];

const STATUS_LABEL = Object.fromEntries(ITEM_STATUSES.map((s) => [s.id, s.label]));
const STAGE_STATUS = {
  not_started: 'pending', fix_failed: 'pending', working: 'progress', waiting_client: 'waiting', needs_input: 'input', blocked: 'blocked',
};

/** The status of one report message in the Updates tab; null when it is not an update (status label, deleted, unsent, plain developer message). */
export function itemStatus(message, local = null) {
  if (!message || message.event || message.deleted || message.pending || message.failed) return null;
  const update = message.update;
  if (update && ['done', 'confirmed'].includes(update.status)) return 'complete';
  if (!update && !local) return message.side === 'tenant' ? 'pending' : null;
  const open = openStatus(message, local);
  return open ? STAGE_STATUS[open.stage] || 'pending' : null;
}

/** One row per task (replies that joined a task count under it), newest first. */
export function updateItems(messages, reasons = {}, summaries = {}) {
  const items = [];
  const byKey = new Map();
  (messages || []).forEach((m) => {
    const local = reasons[m.id] || null;
    const status = itemStatus(m, local);
    if (!status) return;
    const key = m.update?.id || m.id;
    const known = byKey.get(key);
    if (known) {
      known.replies += 1;
      return;
    }
    const open = openStatus(m, local);
    const item = {
      id: m.id,
      key,
      message: m,
      status,
      label: STATUS_LABEL[status],
      title: m.update?.title || messagePreview(m),
      reason: open?.reason || (status === 'pending' ? STAGE_META.not_started.reason : ''),
      reasonHi: local?.reasonHi || '',
      needsClient: status === 'waiting' || status === 'input',
      summary: pickSummary(m.update, summaries[m.id]) || null,
      at: m.createdAt,
      replies: 0,
    };
    byKey.set(key, item);
    items.push(item);
  });
  return items.reverse();
}

export function countItems(items) {
  const counts = Object.fromEntries(ITEM_STATUSES.map((s) => [s.id, 0]));
  (items || []).forEach((i) => { counts.all += 1; counts[i.status] += 1; });
  return counts;
}

export function filterItems(items, status) {
  return !status || status === 'all' ? items : items.filter((i) => i.status === status);
}

/** Every status change plus every developer message and every answer to a specific message, newest first. */
export function historyEntries(messages) {
  const entries = [];
  const sources = new Map();
  (messages || []).forEach((m) => {
    if (!m.event && m.update?.id && !sources.has(m.update.id)) sources.set(m.update.id, m.id);
  });
  (messages || []).forEach((m) => {
    if (m.deleted || m.pending || m.failed) return;
    if (m.event) {
      entries.push({
        id: m.id, target: sources.get(m.update?.id) || m.id, at: m.createdAt, kind: 'status', action: m.event.action, side: m.side, text: eventLabel(m.event, m.senderName, m.mine),
      });
    } else if (m.side === 'platform' || m.replyTo) {
      entries.push({
        id: m.id, target: m.id, at: m.createdAt, kind: 'message', side: m.side, who: m.mine ? 'You' : m.senderName || '', text: messagePreview(m), about: m.replyTo?.text || '',
      });
    }
  });
  return entries.reverse();
}
