const AUTOPLAY_KEY = 'omsking:autofix-autoplay';
const AUTOPLAY_EVENT = 'omsking:autofix-autoplay';
const STATUS_EVENT = 'omsking:autofix-autoplay-status';
const LOG_KEY = 'omsking:autofix-autoplay-log';
const SINCE_KEY = 'omsking:autofix-autoplay-since';
const TARGET_KEY = 'omsking:autofix-autoplay-target';
const LOG_MAX = 30;

/** Kept in localStorage so the loop goes on after Apply fix restarts the dev servers or reloads the page. */
export function autoplayOn() {
  try {
    return globalThis.localStorage?.getItem(AUTOPLAY_KEY) === 'pending';
  } catch {
    return false;
  }
}

/** target: how many messages to complete before play pauses itself; null = all pending. */
export function setAutoplay(on, target = null, events = globalThis) {
  try {
    if (on && target) globalThis.localStorage?.setItem(TARGET_KEY, String(target));
    if (on && !target) globalThis.localStorage?.removeItem(TARGET_KEY);
    if (on) globalThis.sessionStorage?.removeItem(LOG_KEY);
    if (on) globalThis.localStorage?.setItem(SINCE_KEY, String(Date.now()));
    if (on) globalThis.localStorage?.setItem(AUTOPLAY_KEY, 'pending');
    else globalThis.localStorage?.removeItem(AUTOPLAY_KEY);
  } catch {
    /* storage blocked: the loop just stops on reload */
  }
  events.dispatchEvent(new CustomEvent(AUTOPLAY_EVENT, { detail: { on: Boolean(on) } }));
}

/** When Play was pressed: runs that ended before it belong to no session. */
export function autoplaySince() {
  try {
    return Number(globalThis.localStorage?.getItem(SINCE_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function onAutoplayChanged(handler, target = globalThis) {
  const listener = (e) => handler(e.detail.on);
  target.addEventListener(AUTOPLAY_EVENT, listener);
  return () => target.removeEventListener(AUTOPLAY_EVENT, listener);
}

/**
 * What the pending play loop does next with the latest run.
 * lastMessageId: the task of the previous finished run in this loop, so a task that comes back unchanged pauses it.
 */
export function autoplayStep(run, lastMessageId = null, since = 0) {
  if (!run) return { action: 'start' };
  if (run.running) return { action: 'wait' };
  if (since && Date.parse(run.finishedAt || 0) < since) {
    return { action: shouldAutoApply(run) ? 'apply' : 'start' };
  }
  if (run.error) return { action: 'stop', reason: `Auto-fix stopped: ${run.error}` };
  if (run.discarded) return { action: 'stop', reason: 'The last Auto-fix change was discarded' };
  if (run.patchFile && !run.applied) {
    if (shouldAutoApply(run)) return { action: 'apply' };
    if (shouldAutoVerify(run)) return { action: 'verify' };
    return { action: 'stop', reason: 'The last change was not verified; apply or discard it yourself' };
  }
  if (!run.patchFile && run.messageId && run.messageId === lastMessageId) {
    return { action: 'stop', reason: `"${run.message || 'This task'}" came back without a change` };
  }
  return { action: 'start' };
}

/** A finished change goes into the files by itself; failedRunId is a run whose apply already failed. */
export function shouldAutoApply(run, failedRunId = null) {
  if (!run || run.running || run.error || run.discarded || run.applied || !run.patchFile) return false;
  if (run.verification?.pass !== true) return false;
  return run.id !== failedRunId;
}

/** The run the server sent back with a refused (409) Auto-fix action, so a stale button can catch up; else null. */
export function rejectedRun(err) {
  return err?.response?.status === 409 ? err.response.data?.data || null : null;
}

/** The header loop tells the chat what it is doing; the chat shows it in the play modal. */
export function publishAutoplayStatus(status, target = globalThis) {
  target.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: status }));
}

export function onAutoplayStatus(handler, target = globalThis) {
  const listener = (e) => handler(e.detail);
  target.addEventListener(STATUS_EVENT, listener);
  return () => target.removeEventListener(STATUS_EVENT, listener);
}

const FIXER_STEP = 'The fixer agent is working on the message';

/** m:ss since `iso`, for the live timers in the play modal. */
export function elapsedLabel(iso, now = Date.now()) {
  const at = Date.parse(iso || '');
  if (!at) return '';
  const secs = Math.max(0, Math.floor((now - at) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

export function autoplayPhase(run) {
  if (run?.running) {
    if (run.step === FIXER_STEP) return `The fixer agent is working on "${run.message || 'the message'}"`;
    if (run.step) return run.step;
    if (run.state === 'preparing') return 'Checking the Report inbox…';
    if (run.state === 'starting') return 'Starting the Cursor agent…';
    if (run.state === 'verifying') return 'Checking the fix against the client requirement…';
    if (run.verification && !run.verification.pass) return `Fixing "${run.message || 'the message'}" again after the review`;
    return `Fixing "${run.message || 'the next message'}"`;
  }
  if (shouldAutoApply(run)) return 'Applying the fix to your files…';
  return 'Picking the next pending message…';
}

function runResult(run) {
  if (run.running && run.state === 'verifying') return { result: 'Verifying against the client requirement', tone: 'busy' };
  if (run.running) return { result: 'Fixing', tone: 'busy' };
  if (run.error) return { result: `Stopped: ${run.error}`, tone: 'error' };
  if (run.verification && !run.verification.pass) {
    return { result: run.note || `Not verified: ${run.verification.reason || 'not every client point is met'}`, tone: 'error' };
  }
  if (run.discarded) return { result: 'Change discarded', tone: 'error' };
  if (run.patchFile && !run.applied) return { result: 'Applying…', tone: 'busy' };
  if (run.patchFile) {
    const n = run.changedFiles?.length || 0;
    return { result: `Applied · ${n} file${n === 1 ? '' : 's'} changed`, tone: 'done' };
  }
  return { result: 'Done · no file change', tone: 'done' };
}

/** The play session log, newest first, one entry per run. */
export function logRun(log, run) {
  if (!run?.id || !run.messageId) return log;
  const entry = { id: run.id, messageId: run.messageId, message: run.message || '', ...runResult(run) };
  return [entry, ...log.filter((e) => e.id !== run.id)].slice(0, LOG_MAX);
}

export function loadAutoplayLog() {
  try {
    return JSON.parse(globalThis.sessionStorage?.getItem(LOG_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveAutoplayLog(log) {
  try {
    globalThis.sessionStorage?.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* the log is only for the modal */
  }
}

/** A saved change with no verdict yet (made before verification existed): verify it before anything can apply it. */
export function shouldAutoVerify(run, failedRunId = null) {
  if (!run || run.running || run.error || run.discarded || run.applied || !run.patchFile || run.verification) return false;
  return run.id !== failedRunId;
}

export function autoplayTarget() {
  try {
    return Number(globalThis.localStorage?.getItem(TARGET_KEY)) || null;
  } catch {
    return null;
  }
}

/** The Play choice: 'all' or a number; a number at or above the pending count becomes All. Null = not a valid choice. */
export function playTarget(choice, pending) {
  const known = Number.isFinite(pending);
  if (choice === 'all') {
    if (!known) return { all: true, count: null, note: 'All pending messages' };
    return pending > 0 ? { all: true, count: pending, note: `All ${pending} pending messages` } : null;
  }
  const n = /^\d+$/.test(String(choice ?? '').trim()) ? Number(choice) : 0;
  if (!n) return null;
  if (!known) return { all: false, count: n, note: `${n} message${n === 1 ? '' : 's'}` };
  if (pending <= 0) return null;
  if (n > pending) return { all: true, count: pending, note: `Only ${pending} pending: all ${pending} will be fixed` };
  if (n === pending) return { all: true, count: pending, note: `All ${pending} pending messages` };
  return { all: false, count: n, note: `${n} of ${pending} pending messages` };
}

/** Messages completed in this play session reached the chosen number (left In progress ones do not count). */
export function targetReached(log, target) {
  if (!target) return false;
  return log.filter((e) => e.tone === 'done').length >= target;
}
