/** Starting text for the Auto-fix input form: a decision for the developer, or a question the client gets. */
export function inputDraft(request, to, option = '') {
  if (to === 'client') {
    const choices = request.options?.length ? ` (${request.options.join(' or ')})` : '';
    return `${request.unclear}${choices}`;
  }
  return `About "${request.message}": ${request.unclear}\nDecision: ${option}`;
}

/** The messages around the task that Auto-fix already read. */
export function nearbyText(nearby) {
  if (!nearby) return '';
  const line = (side, m) => `${side}: "${m.message}" (${m.status})`;
  return [...nearby.before.map((m) => line('Before', m)), ...nearby.after.map((m) => line('After', m))].join('\n');
}
