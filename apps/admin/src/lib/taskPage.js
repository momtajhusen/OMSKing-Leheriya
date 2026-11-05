const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function firstMatch(text, routes) {
  let best = null;
  for (const route of routes) {
    if (!route.label || route.path.includes(':')) continue;
    const stem = route.label.toLowerCase().replace(/s$/, '');
    const at = text.search(new RegExp(`\\b${escape(stem)}`, 'i'));
    if (at >= 0 && (!best || at < best.at)) best = { at, path: route.path };
  }
  return best?.path || null;
}

/** The app page a report task is about: the page named first in its area (e.g. "Orders list"), else in its fix, else in its message. */
export function taskPage(task, routes) {
  if (!task) return null;
  return firstMatch(task.area || '', routes) || firstMatch(task.fix || '', routes) || firstMatch(task.message || '', routes);
}

/** The page a fixed message's issue was on (live update area, else the local task list one, else its text). */
export function fixedPage(update, summary, routes) {
  if (!update || !['done', 'confirmed'].includes(update.status)) return null;
  return taskPage({ area: update.area || summary?.area || '', fix: update.fix || summary?.fix || '', message: update.title || '' }, routes);
}

/** "Orders kholo; ORDER ID dekho" → the steps to verify a fix, one per line or semicolon. */
export function checkSteps(text) {
  return String(text || '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
}
