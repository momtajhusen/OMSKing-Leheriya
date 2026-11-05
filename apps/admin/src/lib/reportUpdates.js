import { isLocalApp } from './reportChat.js';

/** Display data for each update status; `hint` is the tooltip on the message chip. */
export const STATUS_META = {
  pending: { label: 'Pending', hint: 'Pending' },
  in_progress: { label: 'Pending', hint: 'Pending · the developer is working on it' },
  done: { label: 'Fixed', hint: 'Fixed by the developer · waiting for the client to confirm' },
  confirmed: { label: 'Fixed', hint: 'Fixed and confirmed by the client' },
};

/** Mirrors ACTIONS in apps/backend/src/services/supportUpdates.service.js. */
const RULES = {
  start: { sides: ['platform'], from: ['pending'] },
  complete: { sides: ['platform'], from: ['pending', 'in_progress'] },
  confirm: { sides: ['tenant'], from: ['pending', 'in_progress', 'done'] },
  reopen: { sides: ['platform', 'tenant'], from: ['done', 'confirmed'] },
};

export const ACTION_TOAST = {
  track: 'Marked pending',
  track_start: 'Marked in progress',
  track_complete: 'Marked complete — waiting for the client to confirm',
  start: 'Marked in progress',
  complete: 'Marked fixed — waiting for the client to confirm',
  confirm: 'Confirmed as fixed',
  reopen: 'Marked pending again',
};

export function actionsFor(status, side) {
  return Object.entries(RULES)
    .filter(([, rule]) => rule.sides.includes(side) && rule.from.includes(status))
    .map(([action]) => action);
}

export function eventLabel(event, senderName, mine) {
  const who = mine ? 'You' : (senderName || 'Someone');
  const title = `"${event?.title || 'update'}"`;
  switch (event?.action) {
    case 'start': return `${who} started working on ${title}`;
    case 'complete': return `${who} marked ${title} as fixed`;
    case 'confirm': return `${who} confirmed ${title} is fixed`;
    case 'reopen': return `${who} marked ${title} as pending again`;
    default: return `${who} updated ${title}`;
  }
}

/** Started / marked fixed labels: the message's own status chip already shows this, so the chat leaves them out. */
export function isHistoryEvent(message) {
  return ['start', 'complete'].includes(message?.event?.action);
}

const OPEN = ['pending', 'in_progress'];
const FIXED = ['done', 'confirmed'];

/** The developer's own view of an update: they move it Pending → In progress → Complete. */
function developerOptions(status) {
  if (!status) {
    return [
      { id: 'pending', label: 'Pending', action: 'track', active: false },
      { id: 'progress', label: 'In progress', action: 'track_start', active: false },
      { id: 'complete', label: 'Complete', action: 'track_complete', active: false },
    ];
  }
  const can = actionsFor(status, 'platform');
  return [
    { id: 'pending', label: 'Pending', action: can.includes('reopen') ? 'reopen' : null, active: status === 'pending' },
    { id: 'progress', label: 'In progress', action: can.includes('start') ? 'start' : null, active: status === 'in_progress' },
    { id: 'complete', label: 'Complete', action: can.includes('complete') ? 'complete' : null, active: FIXED.includes(status) },
  ];
}

/**
 * The choices in a message's dropdown: Pending / Fixed for the client, Pending / In progress / Complete for the developer.
 * `status` is null for an untracked message. `action` is what picking the option sends (null when it is already the
 * current mark, or not allowed from here); `active` ticks the current mark. Developer marks exist on localhost only.
 */
export function markOptions(status, side, local = isLocalApp()) {
  if (side === 'platform') return local ? developerOptions(status) : [];
  if (!status) return [{ id: 'pending', label: 'Pending', action: 'track', active: false }];
  const can = actionsFor(status, side);
  const fixedAction = side === 'platform' ? 'complete' : 'confirm';
  return [
    { id: 'pending', label: 'Pending', action: can.includes('reopen') ? 'reopen' : null, active: OPEN.includes(status) },
    {
      id: 'fixed',
      label: 'Fixed',
      action: can.includes(fixedAction) ? fixedAction : null,
      active: status === 'confirmed' || (side === 'platform' && status === 'done'),
    },
  ];
}

/** 'track_complete' = start tracking the message, then complete it; plain actions are a single call. */
export function markSteps(action) {
  const [first, then] = String(action).split('_');
  return first === 'track' && then ? ['track', then] : [action];
}

const DEVELOPER_STATUS = {
  pending: { label: 'Pending', hint: 'The developer has not started yet' },
  in_progress: { label: 'In progress', hint: 'The developer is working on it' },
  done: { label: 'Complete', hint: 'Completed by the developer · waiting for the client to confirm' },
  confirmed: { label: 'Complete', hint: 'Completed by the developer' },
};

/** The short Hinglish hover of a completed task: what the issue was and what fix was applied. */
export function summaryHint(summary) {
  const lines = [];
  if (summary?.issue) lines.push(`Issue: ${summary.issue}`);
  if (summary?.fix) lines.push(`Fixed: ${summary.fix}`);
  return lines.join('\n');
}

/** The summary saved on the live update (any host), else the one from the local task list (localhost). */
export function pickSummary(update, local) {
  return update?.issue || update?.fix ? { issue: update.issue, fix: update.fix } : local;
}

function developerHint(status, summary) {
  const extra = FIXED.includes(status) ? summaryHint(summary) : '';
  return extra ? `${DEVELOPER_STATUS[status].hint}\n${extra}` : DEVELOPER_STATUS[status].hint;
}

/**
 * The chips under a tracked message: the developer's status, plus the client's confirmation once given. Complete shows
 * on every host with its summary; Pending / In progress are the developer's working marks, on localhost only.
 */
export function statusChips(status, local = isLocalApp(), summary = null) {
  const dev = DEVELOPER_STATUS[status];
  if (!dev) return [];
  const chips = local || FIXED.includes(status)
    ? [{ id: 'developer', status, label: `Developer · ${dev.label}`, hint: developerHint(status, summary) }]
    : [];
  if (status === 'confirmed') chips.push({ id: 'client', status, label: 'Client · Confirmed', hint: 'The client confirmed it is fixed' });
  return chips;
}

export const CHAT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'progress', label: 'In progress' },
  { id: 'fixed', label: 'Complete' },
  { id: 'developer', label: 'Developer' },
  { id: 'client', label: 'Client' },
];

/** The whole-chat count for a filter chip; null when the server sent none. */
export function filterCount(counts, id) {
  return typeof counts?.[id] === 'number' ? counts[id] : null;
}

/**
 * Every client message is Pending until work starts on it; Developer / Client mean who made the last mark. Status labels
 * in the chat only show under All.
 */
/** Chat search: every word of the query appears in the message text, sender, file name or task title. */
export function matchesSearch(message, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [message.text, message.senderName, message.attachment?.name, message.update?.title].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function matchesFilter(message, filter) {
  if (!filter || filter === 'all') return true;
  const update = message.update;
  if (message.event || message.deleted) return false;
  if (filter === 'pending') return update ? update.status === 'pending' : message.side === 'tenant';
  if (!update) return false;
  if (filter === 'progress') return update.status === 'in_progress';
  if (filter === 'fixed') return FIXED.includes(update.status);
  if (filter === 'developer') return update.markedBy === 'platform';
  if (filter === 'client') return update.markedBy === 'tenant';
  return true;
}
