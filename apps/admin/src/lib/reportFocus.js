const REPORT_FOCUS_EVENT = 'omsking:report-focus';

/** Opens the Report chat on this message (the header Report button listens). */
export function focusReportMessage(messageId, target = globalThis) {
  if (!messageId) return;
  target.dispatchEvent(new CustomEvent(REPORT_FOCUS_EVENT, { detail: { messageId } }));
}

/** The message Auto-fix is working on, else the one its next click fixes. */
export function autofixTarget({ run, next } = {}) {
  if (run?.running && run.messageId) return run.messageId;
  return next?.messageId || null;
}

export function onReportFocus(handler, target = globalThis) {
  const listener = (e) => handler(e.detail.messageId);
  target.addEventListener(REPORT_FOCUS_EVENT, listener);
  return () => target.removeEventListener(REPORT_FOCUS_EVENT, listener);
}

const AUTOFIX_CHANGED_EVENT = 'omsking:autofix-changed';

/** An Auto-fix was started outside the header button (chat filter or message): the button refreshes. */
export function notifyAutofixChanged(target = globalThis) {
  target.dispatchEvent(new CustomEvent(AUTOFIX_CHANGED_EVENT));
}

export function onAutofixChanged(handler, target = globalThis) {
  target.addEventListener(AUTOFIX_CHANGED_EVENT, handler);
  return () => target.removeEventListener(AUTOFIX_CHANGED_EVENT, handler);
}
