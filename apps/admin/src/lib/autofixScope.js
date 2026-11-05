export const SCOPE_LABEL = {
  all: 'All', pending: 'Pending', progress: 'In progress', fixed: 'Complete', developer: 'Developer', client: 'Client',
};

const WAITS_FOR_INPUT = ['all', 'progress', 'developer'];

const CHIP_FIX_SCOPES = ['pending', 'progress'];

export function canScopeFix(scope) {
  return CHIP_FIX_SCOPES.includes(scope);
}

/** Tasks of this filter that cannot be cleared until the developer pastes what is missing. */
export function blockedFor(scope, requests) {
  return WAITS_FOR_INPUT.includes(scope) ? requests : [];
}

export function pasteGuide(request) {
  if (request.kind === 'waiting') {
    return `Paste what the client was asked for: ${request.unclear || 'more information'}. A link, the text, a file name or the client's answer works.`;
  }
  return `Auto-fix could not decide: ${request.unclear || 'what to change'}. Paste your decision: pick an option below or write your own.`;
}

/** The English error shown when the box is empty: the message stays blocked. */
export function missingInput(request, text) {
  if (String(text || '').trim()) return null;
  return `Not provided: ${request.unclear || 'the required input'}. This message cannot be cleared without it.`;
}

/** The message a just-started Auto-fix works on, for the chat to scroll to. */
export function startedMessage(data, body) {
  return data?.next?.messageId || body?.messageId || null;
}
