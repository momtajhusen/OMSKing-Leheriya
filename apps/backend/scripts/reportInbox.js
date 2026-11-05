#!/usr/bin/env node
/**
 * Report inbox watcher. Reads the live Report chats with the live developer login (SUPPORT_LIVE_EMAIL /
 * SUPPORT_LIVE_PASSWORD) and appends every new client message to client-reports/TASKS.md, saving its photo, video,
 * voice note or document under client-reports/media (video also gets still frames when ffmpeg is installed).
 * Checking only sends GET requests: nothing is marked read, replied to or tracked on live.
 *
 *   node scripts/reportInbox.js              check once
 *   node scripts/reportInbox.js --watch 10   check now and then every 10 minutes
 *   node scripts/reportInbox.js --mark <in-progress|complete|blocked|failed|not-started> <messageId...> [--note text]
 *       set task status; in-progress and complete also show on that message in the live Report chat
 *       complete also takes --issue "<text>" --fix "<text>": short Hinglish lines for the message's detail tooltip,
 *       and --check "<step; step>": how to verify the fix, shown with the message's open-page icon
 *   node scripts/reportInbox.js --ask <messageId> --need "<requirement>" --question "<text for the client>"
 *       ask the client as a reply to their message; the task becomes Waiting for client until they answer
 *   node scripts/reportInbox.js --attach <taskMessageId> <foundMessageId>
 *       fold a message found in the history into the task (collapsed); its own task becomes part of it
 *   node scripts/reportInbox.js --history       print every message of every chat, for searching (reads only)
 *   node scripts/reportInbox.js --sync-summaries  save the issue / fix of every Complete task on its live update
 *   node scripts/reportInbox.js --applied <runId> | --discard <runId> --reason "<why>"
 *       an Auto-fix change was applied to the main files (its tasks become Complete) or will not be (Fix failed)
 *   node scripts/reportInbox.js --flag-unapplied  one-time scan: Complete tasks whose Auto-fix patch is not applied
 *       go back to Awaiting apply
 *   node scripts/reportInbox.js --unclear <id> --need "<what is unclear>" [--need-hi "<same need in Hinglish>"] --options "a | b" --from <developer|client> [--during testing]
 *       still unclear after the task and its nearby messages: Needs input, answered in the Auto-fix form
 *   Inside an Auto-fix run (REPORT_AUTOFIX_RUN set) --mark complete only sets Awaiting apply.
 *
 * A check that finds new messages prints a line starting with REPORT_INBOX_NEW; a failed check prints REPORT_INBOX_ERROR.
 */
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const DEFAULT_OUT_DIR = path.resolve(__dirname, '../../../client-reports');
const PAGE = 100;
const RENEW_BEFORE_MS = 60 * 1000;
const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav',
  'application/pdf': '.pdf',
};
const KIND_LABEL = { image: 'Photo', video: 'Video', audio: 'Voice note', file: 'Document' };
const EVENT_LABEL = { confirm: 'Client confirmed the fix', reopen: 'Client reopened', start: 'Started', complete: 'Marked done' };
const STATUSES = [
  'Complete', 'In progress', 'Not started', 'Blocked', 'Fix failed', 'Waiting for client', 'Client replied', 'Awaiting apply', 'Needs input', 'Input given',
];
/** Still unclear after reading the task and its nearby messages: waits for the developer's answer in the Auto-fix form. */
const NEEDS_INPUT = 'Needs input';
/** Task list statuses behind each Report chat filter (the live chat shows waiting / asked tasks as In progress). */
const SCOPE_STATUSES = {
  pending: ['Not started'],
  client: ['Not started'],
  progress: ['In progress', 'Client replied', 'Input given', 'Waiting for client'],
  developer: ['In progress', 'Client replied', 'Input given', 'Waiting for client'],
  fixed: [],
};
const INPUT_GIVEN = 'Input given';
const WAITING = 'Waiting for client';
/** Fixed in an Auto-fix copy, but the change is not in the main files yet: Complete only once it is applied. */
const AWAITING = 'Awaiting apply';
const REPLIED = 'Client replied';
const QUESTION_MAX = 1000;
const OVERVIEW_START = '<!-- status-overview:start -->';
const OVERVIEW_END = '<!-- status-overview:end -->';
const TASKS_HEADER = `# Client report tasks

New client messages from the live Report chat are added here automatically, oldest first.
Every task heading starts with its status: [Not started], [In progress], [Complete], [Blocked], [Fix failed],
[Waiting for client] (the client was asked for something) or [Client replied] (their answer is attached, ready to fix).
The status overview is rebuilt from those headings on every check; the watcher never rewrites the tasks themselves.
`;

/** Client messages newer than `lastSeenId`, oldest first. Ids are ObjectIds, so their hex order is their time order. */
function clientMessagesAfter(rows, lastSeenId) {
  return rows.filter((m) => m.side === 'tenant' && !m.deleted && (!lastSeenId || m.id > lastSeenId));
}

function safeName(name) {
  return path.basename(String(name || '')).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-80);
}

/** File name for a message's attachment; never contains a folder part. */
function mediaFileName(m) {
  const att = m.attachment || {};
  const stamp = String(m.createdAt || '').slice(0, 16).replace(/[-:T]/g, '');
  const base = `${stamp}-${String(m.id).slice(-6)}`;
  const fromName = safeName(att.name);
  if (att.kind === 'file' && fromName) return `${base}-${fromName}`;
  return `${base}${MIME_EXT[String(att.mime || '').split(';')[0]] || path.extname(fromName) || '.bin'}`;
}

function when(iso) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

function taskEntry(m, tenantName, files) {
  const lines = [`### [Not started] ${when(m.createdAt)} · ${tenantName} · ${m.senderName || 'Client'}`];
  if (m.event) {
    lines.push(`- ${EVENT_LABEL[m.event.action] || 'Status changed'}: ${m.event.title || ''}`);
    if (m.event.note) lines.push(`- Client note: ${m.event.note}`);
  }
  if (m.text) lines.push(`- Message: ${m.text.replace(/\s*\n\s*/g, ' / ')}`);
  if (m.replyTo) lines.push(`- In reply to: ${m.replyTo.text || KIND_LABEL[m.replyTo.kind] || ''}`);
  files.forEach((f) => lines.push(`- ${f.label}: [${f.file}](${f.file})`));
  lines.push('- Type: _to triage_', '- Notes:', `- Message id: ${m.id}`);
  return `${lines.join('\n')}\n`;
}

/** Status, time and message of every task heading; old "[ ]" / "[x]" headings read as Not started / Complete. */
function taskRows(entries) {
  return entries.split(/^(?=### )/m).filter((block) => block.startsWith('### ')).map((block) => {
    const head = /^### \[([^\]]*)\] ?([^\n]*)/.exec(block) || [];
    const mark = String(head[1] ?? '').trim();
    const status = { '': 'Not started', x: 'Complete', X: 'Complete' }[mark] ?? mark;
    const message = (/^- Message: (.*)$/m.exec(block) || /^- (?!Type:|Notes:|Message id:)(.*)$/m.exec(block) || [])[1] || '';
    return { status, time: String(head[2] || '').split(' · ')[0], message };
  });
}

function taskBlocks(text) {
  const end = text.indexOf(OVERVIEW_END);
  const entries = end >= 0 ? text.slice(end + OVERVIEW_END.length) : text;
  const blocks = entries.split(/^(?=### )/m).filter((b) => b.startsWith('### '));
  return taskRows(entries).map((row, i) => {
    const block = blocks[i];
    const questions = [...block.matchAll(/^- Asked client: .*\(question id (\w+)/gm)].map((m) => m[1]);
    const verified = [...block.matchAll(/^- Status: (?:Already )?fixed and verified[^—\n]*— (.*)$/gim)].map((m) => m[1]);
    return {
      ...row,
      messageId: (/^- Message id: (\w+)/m.exec(block) || [])[1] || null,
      need: (/^- Waiting for: (.*)$/m.exec(block) || [])[1] || '',
      questions,
      partOf: (/^- Part of: (\w+)/m.exec(block) || [])[1] || null,
      area: (/^- Type: [^(\n]*\(([^)\n]*)\)/m.exec(block) || [])[1] || '',
      hasSummary: /^- (Issue|Fix): /m.test(block),
      issue: (/^- Issue: (.*)$/m.exec(block) || [])[1] || '',
      fix: (/^- Fix: (.*)$/m.exec(block) || [])[1] || verified[verified.length - 1] || '',
      fixLine: (/^- Fix: (.*)$/m.exec(block) || [])[1] || '',
      check: (/^- Check: (.*)$/m.exec(block) || [])[1] || '',
      pendingRun: (/^- Pending patch: Auto-fix run (\S+)/m.exec(block) || [])[1] || null,
      unclear: (/^- Unclear: (.*)$/m.exec(block) || [])[1] || '',
      unclearHi: (/^- Unclear in Hinglish: (.*)$/m.exec(block) || [])[1] || '',
      needHi: (/^- Waiting for in Hinglish: (.*)$/m.exec(block) || [])[1] || '',
      askedDuring: (/^- Asked during: (\w+)/m.exec(block) || [])[1] || '',
      options: ((/^- Options: (.*)$/m.exec(block) || [])[1] || '').split(' | ').filter(Boolean),
      inputFrom: (/^- Input from: (\w+)/m.exec(block) || [])[1] || '',
      reason: (/^- Reason: (.*)$/m.exec(block) || [])[1] || '',
      statuses: [...block.matchAll(/^- Status: (.*)$/gm)].map((m) => m[1]),
    };
  });
}

/**
 * The first Not started task after the last Complete one (from the top when none is Complete), or null. Tasks that
 * are part of another task, and the ids in `skip`, are never picked on their own.
 */
function nextTask(text, skip = []) {
  const rows = taskBlocks(text);
  const lastDone = rows.map((r) => (r.status === AWAITING ? 'Complete' : r.status)).lastIndexOf('Complete');
  const open = (r) => r.status === 'Not started' && r.messageId && !r.partOf && !skip.includes(r.messageId);
  const row = rows.slice(lastDone + 1).find(open) || rows.find(open);
  return row ? { messageId: row.messageId, time: row.time, message: row.message } : null;
}

/** The pending tasks in the order Pending auto-play fixes them (nextTask, again and again), at most `limit`. */
function pendingQueue(text, limit = Infinity) {
  const queue = [];
  while (queue.length < limit) {
    const row = nextTask(text, queue.map((q) => q.messageId));
    if (!row) break;
    queue.push(row);
  }
  return queue;
}

/**
 * What one Auto-fix click works on, in strict order: a task whose client reply has arrived; else a task an interrupted
 * run left In progress (only one run works at a time, so nothing else is on it); else the tasks waiting for
 * the client (the agent searches the whole history for each requirement, and falls back to `next` when none is found);
 * else the next pending task. A waiting task never blocks the rest: `next` is always the following pending task.
 */
function planAutofix(text, { scope = 'all', messageId = '' } = {}) {
  const statuses = messageId ? null : SCOPE_STATUSES[scope] || null;
  const inScope = (r) => (!messageId || r.messageId === messageId) && (!statuses || statuses.includes(r.status));
  const rows = taskBlocks(text).filter((r) => r.messageId && !r.partOf && inScope(r));
  const brief = (r) => (r ? { messageId: r.messageId, message: r.message } : null);
  const pick = (skip = []) => {
    if (messageId) return rows.find((r) => r.status === 'Not started' && !skip.includes(r.messageId)) || null;
    return !statuses || statuses.includes('Not started') ? nextTask(text, skip) : null;
  };
  const next = brief(pick());
  const replied = rows.find((r) => r.status === REPLIED || r.status === INPUT_GIVEN);
  if (replied?.status === INPUT_GIVEN) return { kind: 'replied', task: { ...brief(replied), unclear: replied.unclear, input: true }, next };
  if (replied) return { kind: 'replied', task: { ...brief(replied), need: replied.need }, next };
  const stuck = rows.find((r) => r.status === 'In progress');
  if (stuck) return { kind: 'resume', task: brief(stuck), next };
  const waiting = rows.filter((r) => r.status === WAITING);
  if (waiting.length) {
    return { kind: 'waiting', waiting: waiting.map((r) => ({ ...brief(r), need: r.need, questionId: r.questions[r.questions.length - 1] || null })), next };
  }
  if (next) return { kind: 'next', task: next, next: brief(pick([next.messageId])) };
  return null;
}

/** The tasks just before and after this one in the list (2 each): a requirement is often split over them. */
function nearbyTasks(text, messageId, span = 2) {
  const rows = taskBlocks(text).filter((r) => r.messageId);
  const at = rows.findIndex((r) => r.messageId === messageId);
  const pick = (list) => list.map((r) => ({ messageId: r.messageId, message: r.message, status: r.status }));
  if (at < 0) return { before: [], after: [] };
  return { before: pick(rows.slice(Math.max(0, at - span), at)), after: pick(rows.slice(at + 1, at + 1 + span)) };
}

/** The page area from the task's Type line, e.g. "Orders list" from "Type: Bug (Orders list)". */
function taskArea(text, messageId) {
  return taskBlocks(text).find((r) => r.messageId === messageId)?.area || '';
}

/** Tasks waiting for input in the Auto-fix form, with what is unclear, the options and the nearby messages. */
function inputRequests(text) {
  return taskBlocks(text).filter((r) => (r.status === NEEDS_INPUT || r.status === WAITING) && r.messageId).map((r) => {
    const waiting = r.status === WAITING;
    const needHi = waiting ? r.needHi : r.unclearHi;
    return {
      messageId: r.messageId,
      message: r.message,
      kind: waiting ? 'waiting' : 'unclear',
      unclear: waiting ? r.need : r.unclear,
      ...(needHi ? { needHi } : {}),
      ...(!waiting && r.askedDuring === 'testing' ? { during: 'testing' } : {}),
      options: waiting ? [] : r.options,
      from: waiting ? 'client' : r.inputFrom || 'developer',
      nearby: nearbyTasks(text, r.messageId),
    };
  });
}

const SUMMARY_MAX = 160;
const brief = (s) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s);

/**
 * Issue and fix of every Complete task, by message id, for the detail tooltip on its chat message. They come from the
 * short Hinglish "- Issue:" / "- Fix:" lines saved when it was completed (older tasks: the message and the "Fixed and
 * verified … —" status). A task that is part of another shares that task's summary.
 */
function taskSummaries(text) {
  const rows = taskBlocks(text).filter((r) => r.messageId && r.status === 'Complete');
  const own = new Map(rows.map((r) => [r.messageId, { issue: brief(r.issue || r.message), fix: brief(r.fix), area: r.area, ...(r.check ? { check: r.check } : {}) }]));
  return Object.fromEntries(rows.map((r) => [r.messageId, (r.partOf && own.get(r.partOf)) || own.get(r.messageId)]));
}

const REASON_MAX = 400;
const NOT_STARTED_REASON = 'Not started yet. It is in the queue and will be worked on in order.';

function reasonText(text) {
  const clean = oneLine(String(text || '').replace(/;\s*(made by Auto-fix|local only).*$/i, ''));
  return clean.length > REASON_MAX ? `${clean.slice(0, REASON_MAX - 1)}…` : clean;
}

function lastMatch(list, re) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = re.exec(list[i]);
    if (m) return m[1];
  }
  return '';
}

/** Why a task that is not Complete is still open, in English, with the chat stage it maps to. */
function ownReason(r) {
  switch (r.status) {
    case 'Not started': return { stage: 'not_started', reason: NOT_STARTED_REASON };
    case WAITING: return { stage: 'waiting_client', reason: `Waiting for the client: ${r.need || 'the information asked for in the reply'}` };
    case NEEDS_INPUT: return { stage: 'needs_input', reason: `Needs a decision from the ${r.inputFrom || 'developer'}: ${r.unclear || 'how this should work'}` };
    case 'Blocked': return { stage: 'blocked', reason: `Blocked: ${lastMatch(r.statuses, /^Blocked — (?:[^:]*\d{4}: )?(.*)$/) || 'it needs something that cannot be done from here'}` };
    case 'Fix failed': {
      const why = lastMatch(r.statuses, /(?:discarded, not applied|failed): (.*)$/);
      return { stage: 'fix_failed', reason: `The last fix attempt failed${why ? ` (${why})` : ''}; it will be tried again.` };
    }
    case REPLIED: return { stage: 'working', reason: 'The client replied; it will be fixed next.' };
    case INPUT_GIVEN: return { stage: 'working', reason: 'The decision was given; it will be fixed next.' };
    case AWAITING: return { stage: 'working', reason: 'The fix is ready and waiting to be applied.' };
    default: {
      const why = lastMatch(r.statuses, /Not verified yet: (.*?)(?:\. The change is saved.*)?$/);
      return { stage: 'working', reason: why ? `The fix is made but not verified yet: ${why}` : 'The developer is working on it.' };
    }
  }
}

/** Stage and English reason of every open task by message id; a "- Reason:" line wins, a part follows its parent. */
function taskReasons(text) {
  const rows = taskBlocks(text).filter((r) => r.messageId && r.status !== 'Complete');
  const byId = new Map(taskBlocks(text).filter((r) => r.messageId).map((r) => [r.messageId, r]));
  const own = (r) => {
    const found = ownReason(r);
    return r.reason ? { stage: found.stage, reason: r.reason } : found;
  };
  const hindi = (r) => {
    const hi = r.status === WAITING ? r.needHi : r.status === NEEDS_INPUT ? r.unclearHi : '';
    return hi ? { reasonHi: reasonText(hi) } : {};
  };
  return Object.fromEntries(rows.map((r) => {
    const parent = r.partOf && byId.get(r.partOf);
    if (r.reason || !parent || parent.status === 'Complete') return [r.messageId, { ...own(r), reason: reasonText(own(r).reason), ...hindi(r) }];
    const lead = own(parent);
    const leadHi = hindi(parent).reasonHi;
    return [r.messageId, {
      stage: lead.stage,
      reason: reasonText(`Handled together with "${brief(parent.message)}". ${lead.reason}`),
      ...(leadHi ? { reasonHi: reasonText(`"${brief(parent.message)}" ke saath hi hoga. ${leadHi}`) } : {}),
    }];
  }));
}

/** The task list with the "- <key>:" line of the task for `messageId` set (replaced, or added above its id line). */
function setTaskLine(text, messageId, key, value) {
  const at = text.indexOf(`- Message id: ${messageId}`);
  if (at < 0) return text;
  const head = text.lastIndexOf('\n### ', at) + 1;
  const block = text.slice(head, at);
  const line = `- ${key}: ${oneLine(value)}\n`;
  const existing = new RegExp(`^- ${key}: .*\\n`, 'm');
  return text.slice(0, head) + (existing.test(block) ? block.replace(existing, line) : `${block}${line}`) + text.slice(at);
}

/** The task list without the "- <key>:" line of the task for `messageId`. */
function removeTaskLine(text, messageId, key) {
  const at = text.indexOf(`- Message id: ${messageId}`);
  if (at < 0) return text;
  const head = text.lastIndexOf('\n### ', at) + 1;
  return text.slice(0, head) + text.slice(head, at).replace(new RegExp(`^- ${key}: .*\\n`, 'm'), '') + text.slice(at);
}

/** The task list with `block` added to the task for `messageId`, just above its "- Message id:" line. */
function addToTask(text, messageId, block) {
  const at = text.indexOf(`- Message id: ${messageId}`);
  return at < 0 ? text : `${text.slice(0, at)}${block}${text.slice(at)}`;
}

const oneLine = (s) => String(s || '').trim().replace(/\s*\n\s*/g, ' / ');

/** A message folded into a task as a collapsed block with its text, files and id. */
function collapsed(title, m, files, idLabel) {
  const short = oneLine(m.text) || KIND_LABEL[m.attachment?.kind] || '';
  const summary = (short.length > 80 ? `${short.slice(0, 79)}…` : short).replace(/</g, '&lt;');
  const lines = [`<details><summary>${title} · ${when(m.createdAt)} · ${summary}</summary>`, ''];
  if (m.text) lines.push(`- Message: ${oneLine(m.text)}`);
  files.forEach((f) => lines.push(`- ${f.label}: [${f.file}](${f.file})`));
  lines.push(`- ${idLabel}: ${m.id}`, '', '</details>');
  return `${lines.join('\n')}\n`;
}

/** Status label of the task for `messageId`, or null when it is not in the list. */
function taskStatus(text, messageId) {
  return taskBlocks(text).find((r) => r.messageId === messageId)?.status ?? null;
}

/** How many tasks are pending, being worked on and complete. */
function statusCounts(text) {
  const tasks = taskBlocks(text);
  const count = (statuses) => tasks.filter((r) => statuses.includes(r.status)).length;
  return {
    pending: count(SCOPE_STATUSES.pending), progress: count(SCOPE_STATUSES.progress), complete: count(['Complete']), total: tasks.length,
  };
}

function cell(text) {
  const short = text.length > 90 ? `${text.slice(0, 89)}…` : text;
  return short.replace(/\|/g, '\\|');
}

/** The task list with its status overview (counts plus one row per task) rebuilt above the tasks. */
function withOverview(text) {
  const start = text.indexOf(OVERVIEW_START);
  const end = text.indexOf(OVERVIEW_END);
  let head;
  let entries;
  if (start >= 0 && end > start) {
    head = text.slice(0, start);
    entries = text.slice(end + OVERVIEW_END.length);
  } else {
    const first = text.search(/^### /m);
    head = `${(first >= 0 ? text.slice(0, first) : text).trimEnd()}\n\n`;
    entries = first >= 0 ? `\n\n${text.slice(first)}` : '';
  }
  const rows = taskRows(entries);
  const block = [
    OVERVIEW_START,
    '## Status overview',
    '',
    STATUSES.map((s) => `${s} ${rows.filter((r) => r.status === s).length}`).join(' · '),
    '',
    '| # | Status | Time | Message |',
    '|---|---|---|---|',
    ...rows.map((r, i) => `| ${i + 1} | ${r.status} | ${r.time} | ${cell(r.message)} |`),
    '',
    OVERVIEW_END,
  ].join('\n');
  return `${head}${block}${entries}`;
}

function liveApi(settings) {
  const origin = new URL(settings.url).origin;
  let session = null;

  async function signIn() {
    if (!settings.email || !settings.password) {
      throw new Error('Live developer login is not set up: add SUPPORT_LIVE_EMAIL and SUPPORT_LIVE_PASSWORD to apps/backend/.env');
    }
    const res = await fetch(`${settings.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: settings.email, password: settings.password }),
    });
    const token = (await res.json().catch(() => null))?.data?.accessToken;
    if (res.status !== 200 || !token) throw new Error(`The live API refused the developer login (HTTP ${res.status})`);
    let exp = 0;
    try { exp = Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp) * 1000 || 0; } catch { /* opaque token */ }
    session = { token, expiresAt: exp || Date.now() + 10 * 60 * 1000 };
  }

  async function request(method, apiPath, body, renew = false) {
    if (renew || !session || session.expiresAt - RENEW_BEFORE_MS < Date.now()) await signIn();
    const res = await fetch(`${settings.url}${apiPath}`, {
      method,
      headers: { authorization: `Bearer ${session.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401 && !renew) return request(method, apiPath, body, true);
    if (!res.ok) {
      const reason = (await res.json().catch(() => null))?.message;
      throw new Error(`Live API ${method} ${apiPath.split('?')[0]} answered HTTP ${res.status}${reason ? `: ${reason}` : ''}`);
    }
    return res.json();
  }

  const get = (apiPath) => request('GET', apiPath);

  async function download(mediaUrl, target) {
    const res = await fetch(`${origin}${mediaUrl}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  }

  return { get, request, download };
}

async function threadMessages(api, tenantId, lastSeenId) {
  const rows = [];
  let before = null;
  for (;;) {
    const query = new URLSearchParams({ limit: String(PAGE) });
    if (before) query.set('before', before);
    const page = await api.get(`/support/threads/${encodeURIComponent(tenantId)}/messages?${query}`);
    const batch = page.data || [];
    rows.unshift(...batch);
    if (!page.meta?.hasMore || !batch.length || (lastSeenId && batch[0].id <= lastSeenId)) return rows;
    before = batch[0].id;
  }
}

/** Still frames from a video, one every 2 seconds (at most 20), so the recording can be looked at as pictures. */
function extractFrames(videoPath) {
  const dir = `${videoPath}-frames`;
  fs.mkdirSync(dir, { recursive: true });
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-loglevel', 'error', '-y', '-i', videoPath, '-vf', 'fps=1/2', '-frames:v', '20', path.join(dir, 'frame-%02d.jpg')],
      { timeout: 120000 }, (err) => {
        if (err || !fs.readdirSync(dir).length) {
          fs.rmSync(dir, { recursive: true, force: true });
          return resolve(null);
        }
        return resolve(dir);
      });
  });
}

async function saveAttachment(api, m, outDir) {
  const att = m.attachment;
  if (!att?.url) return [];
  const mediaDir = path.join(outDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const name = mediaFileName(m);
  const label = KIND_LABEL[att.kind] || 'File';
  try {
    await api.download(att.url, path.join(mediaDir, name));
  } catch (err) {
    return [{ label: `${label} (download failed: ${err.message})`, file: att.name || name }];
  }
  const files = [{ label, file: `media/${name}` }];
  if (att.kind === 'video') {
    const frames = await extractFrames(path.join(mediaDir, name));
    if (frames) files.push({ label: 'Video frames', file: `media/${path.basename(frames)}` });
  }
  return files;
}

/**
 * A client message that replies to a question we asked (or to the waiting task's own message) is folded into that task,
 * collapsed, instead of becoming a new task; a task that was Waiting for client becomes Client replied.
 */
function attachReply(tasksFile, m, files) {
  if (!m.replyTo?.id) return false;
  const text = fs.readFileSync(tasksFile, 'utf8');
  const owner = taskBlocks(text).find((r) => r.messageId && (r.questions.includes(m.replyTo.id) || (r.status === WAITING && r.messageId === m.replyTo.id)));
  if (!owner) return false;
  let next = addToTask(text, owner.messageId, collapsed('Client reply', m, files, 'Reply message id'));
  if (owner.status === WAITING) next = setTaskLabel(next, owner.messageId, REPLIED);
  fs.writeFileSync(tasksFile, next);
  return true;
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { lastSeen: {} }; }
}

/** One pass over the live inbox. Returns { count, threads: [{ tenant, count }] }. */
async function runOnce({ settings, outDir = DEFAULT_OUT_DIR, logger = console } = {}) {
  const api = liveApi(settings);
  fs.mkdirSync(outDir, { recursive: true });
  const stateFile = path.join(outDir, '.state.json');
  const tasksFile = path.join(outDir, 'TASKS.md');
  const state = readState(stateFile);
  state.lastSeen = state.lastSeen || {};

  const threads = (await api.get('/support/threads')).data || [];
  const summary = { count: 0, replies: 0, threads: [] };
  for (const thread of threads) {
    const lastSeenId = state.lastSeen[thread.tenantId] || null;
    if (!thread.lastMessage || (lastSeenId && thread.lastMessage.id <= lastSeenId)) continue;
    const rows = await threadMessages(api, thread.tenantId, lastSeenId);
    const fresh = clientMessagesAfter(rows, lastSeenId);
    if (fresh.length) {
      if (!fs.existsSync(tasksFile)) fs.writeFileSync(tasksFile, TASKS_HEADER);
      let added = 0;
      for (const m of fresh) {
        const files = await saveAttachment(api, m, outDir);
        if (attachReply(tasksFile, m, files)) {
          summary.replies += 1;
        } else {
          fs.appendFileSync(tasksFile, `\n${taskEntry(m, thread.tenantName, files)}`);
          added += 1;
        }
      }
      summary.count += added;
      if (added) summary.threads.push({ tenant: thread.tenantName, count: added });
    }
    if (rows.length) state.lastSeen[thread.tenantId] = rows[rows.length - 1].id;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }

  if (fs.existsSync(tasksFile)) {
    const current = fs.readFileSync(tasksFile, 'utf8');
    const next = withOverview(current);
    if (next !== current) fs.writeFileSync(tasksFile, next);
  }

  const at = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (summary.count || summary.replies) {
    logger.log(`REPORT_INBOX_NEW ${JSON.stringify({ count: summary.count, replies: summary.replies, threads: summary.threads, tasks: tasksFile })}`);
  } else {
    logger.log(`report-inbox: checked at ${at}, no new client messages`);
  }
  return summary;
}

const MARKS = { 'not-started': 'Not started', 'in-progress': 'In progress', complete: 'Complete', blocked: 'Blocked', failed: 'Fix failed' };
/** Developer actions that move a live chat message from its current status to the mark. Other marks stay off the chat. */
const LIVE_STEPS = {
  'in-progress': { pending: ['start'], in_progress: [], done: ['reopen', 'start'], confirmed: ['reopen', 'start'] },
  complete: { pending: ['complete'], in_progress: ['complete'], done: [], confirmed: [] },
};

async function findLiveMessage(api, messageId) {
  const threads = (await api.get('/support/threads')).data || [];
  for (const thread of threads) {
    if (!thread.lastMessage || thread.lastMessage.id < messageId) continue;
    const rows = await threadMessages(api, thread.tenantId, messageId);
    const message = rows.find((m) => m.id === messageId);
    if (message) return { tenantId: thread.tenantId, message };
  }
  return null;
}

/** Tracks the live chat message as an update if needed, then moves it to the mark (in-progress or complete). */
async function moveLive(api, found, mark, note = '') {
  const updates = `/support/threads/${encodeURIComponent(found.tenantId)}/updates`;
  let update = found.message.update;
  if (!update) update = (await api.request('POST', updates, { messageId: found.message.id })).data;
  for (const action of LIVE_STEPS[mark][update.status] || []) {
    update = (await api.request('PATCH', `${updates}/${encodeURIComponent(update.id)}`, { action, ...(note ? { note } : {}) })).data;
  }
  return update;
}

/**
 * Saves the task's issue / fix on its completed live update, so the hover shows on the live site too. A live server
 * that does not know summaries yet only costs a log line: the task list keeps them for a later --sync-summaries.
 */
async function saveLiveSummary(api, found, update, summary, logger) {
  const url = `/support/threads/${encodeURIComponent(found.tenantId)}/updates/${encodeURIComponent(update.id)}`;
  try {
    await api.request('PATCH', url, {
      action: 'summary', issue: summary.issue, fix: summary.fix, area: summary.area, ...(summary.check ? { check: summary.check } : {}),
    });
    return true;
  } catch (err) {
    logger.log(`report-inbox: summary not saved on live for ${found.message.id}: ${err.message}`);
    return false;
  }
}

/** The task list with the status label of the task for `messageId` replaced. */
function setTaskLabel(text, messageId, label) {
  const at = text.indexOf(`- Message id: ${messageId}`);
  if (at < 0) return text;
  const head = text.lastIndexOf('\n### [', at) + 1;
  return text.slice(0, head) + text.slice(head).replace(/^### \[[^\]]*\]/, `### [${label}]`);
}

/**
 * Sets the status of the tasks for these client messages. In progress and Complete also go on the message in the live
 * Report chat (tracked as an update, then started or completed with the developer login); messages nobody works on are
 * never touched. Not started, Blocked and Fix failed only change the task list.
 */
async function markTasks({
  settings, outDir = DEFAULT_OUT_DIR, mark, messageIds = [], note = '', issue = '', fix = '', check = '', pendingRun = '', logger = console,
}) {
  if (!MARKS[mark]) throw new Error(`Unknown status "${mark}": use ${Object.keys(MARKS).join(', ')}`);
  const deferred = mark === 'complete' && Boolean(pendingRun);
  const label = deferred ? AWAITING : MARKS[mark];
  const tasksFile = path.join(outDir, 'TASKS.md');
  const api = LIVE_STEPS[mark] && !deferred ? liveApi(settings) : null;
  for (const id of messageIds) {
    let found = null;
    let update = null;
    if (api) {
      found = await findLiveMessage(api, id);
      if (!found) throw new Error(`Message ${id} is not in the live Report chat`);
      update = await moveLive(api, found, mark, note);
    }
    if (fs.existsSync(tasksFile)) {
      const current = fs.readFileSync(tasksFile, 'utf8');
      let next = setTaskLabel(current, id, label);
      if (mark === 'complete' && oneLine(issue)) next = setTaskLine(next, id, 'Issue', issue);
      if (mark === 'complete' && oneLine(fix)) next = setTaskLine(next, id, 'Fix', fix);
      if (mark === 'complete' && oneLine(check)) next = setTaskLine(next, id, 'Check', check);
      if (deferred) next = setTaskLine(next, id, 'Pending patch', `Auto-fix run ${pendingRun} — apply it with the header Apply fix button`);
      else if (mark === 'complete') next = removeTaskLine(next, id, 'Pending patch');
      next = withOverview(next);
      if (next !== current) fs.writeFileSync(tasksFile, next);
      const summary = taskSummaries(next)[id];
      if (update && mark === 'complete' && (oneLine(issue) || oneLine(fix) || oneLine(check)) && summary) {
        await saveLiveSummary(api, found, update, summary, logger);
      }
    }
    logger.log(`report-inbox: ${id} is now ${label}${api ? ' in the live Report chat and the task list' : ' in the task list'}${
      deferred ? '; it becomes Complete when the Auto-fix change is applied' : ''}`);
  }
}

const runTasks = (text, runId) => taskBlocks(text).filter((r) => r.status === AWAITING && r.pendingRun === runId && r.messageId);

/** The Auto-fix change of `runId` is now in the main files: its Awaiting apply tasks become Complete (task list and live). */
async function completeApplied({ settings, outDir = DEFAULT_OUT_DIR, runId, logger = console }) {
  const rows = runTasks(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'), runId);
  for (const row of rows) {
    await markTasks({ settings, outDir, mark: 'complete', messageIds: [row.messageId], issue: row.issue, fix: row.fixLine, check: row.check, logger });
  }
  return rows.map((r) => r.messageId);
}

/** The Auto-fix change of `runId` could not be verified: its Awaiting apply tasks go back to In progress with the reason. */
function holdRun({ outDir = DEFAULT_OUT_DIR, runId, reason }) {
  const why = oneLine(reason);
  const rows = runTasks(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'), runId);
  updateTasks(outDir, (text) => rows.reduce((acc, row) => addToTask(
    removeTaskLine(setTaskLabel(acc, row.messageId, MARKS['in-progress']), row.messageId, 'Pending patch'),
    row.messageId,
    `- Status: ${when(new Date().toISOString())} — Auto-fix left it In progress. ${why}\n`,
  ), text));
  return rows.map((r) => r.messageId);
}

/** The Auto-fix change of `runId` will not be applied: its Awaiting apply tasks become Fix failed with the reason. */
function discardRun({ outDir = DEFAULT_OUT_DIR, runId, reason }) {
  const why = oneLine(reason);
  if (!why) throw new Error('Give a reason for discarding the Auto-fix change');
  const tasksFile = path.join(outDir, 'TASKS.md');
  const rows = runTasks(fs.readFileSync(tasksFile, 'utf8'), runId);
  updateTasks(outDir, (text) => rows.reduce((acc, row) => addToTask(
    removeTaskLine(setTaskLabel(acc, row.messageId, MARKS.failed), row.messageId, 'Pending patch'),
    row.messageId,
    `- Status: ${when(new Date().toISOString())} — Auto-fix change discarded, not applied: ${why}\n`,
  ), text));
  return rows.map((r) => r.messageId);
}

/** The task stays unclear after its nearby messages: Needs input, with what is unclear and the options (task list only). */
function needInput({ outDir = DEFAULT_OUT_DIR, messageId, unclear, unclearHi = '', options = [], from = 'developer', during = '' }) {
  const what = oneLine(unclear);
  const hindi = oneLine(unclearHi);
  if (!what) throw new Error('Say what is unclear with --need "<what is unclear>"');
  if (!['developer', 'client'].includes(from)) throw new Error('--from must be developer or client');
  if (!['', 'testing'].includes(during)) throw new Error('--during can only be testing');
  const choices = options.map(oneLine).filter(Boolean);
  const text = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
  if (!taskBlocks(text).some((r) => r.messageId === messageId)) throw new Error(`Task ${messageId} is not in the task list`);
  updateTasks(outDir, (t) => {
    let next = setTaskLine(setTaskLabel(t, messageId, NEEDS_INPUT), messageId, 'Unclear', what);
    next = hindi ? setTaskLine(next, messageId, 'Unclear in Hinglish', hindi) : removeTaskLine(next, messageId, 'Unclear in Hinglish');
    next = choices.length ? setTaskLine(next, messageId, 'Options', choices.join(' | ')) : removeTaskLine(next, messageId, 'Options');
    next = during ? setTaskLine(next, messageId, 'Asked during', during) : removeTaskLine(next, messageId, 'Asked during');
    return setTaskLine(next, messageId, 'Input from', from);
  });
}

/** The developer's answer from the Auto-fix form: added collapsed under the task, which is then fixed first (Input given). */
function provideInput({ outDir = DEFAULT_OUT_DIR, messageId, text: answer }) {
  const body = String(answer || '').trim();
  if (!body) throw new Error('Write the answer first');
  const text = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
  if (![NEEDS_INPUT, WAITING].includes(taskStatus(text, messageId))) throw new Error(`Task ${messageId} is not waiting for input`);
  const short = oneLine(body).slice(0, 80);
  const block = `<details><summary>Developer input · ${when(new Date().toISOString())} · ${short}</summary>\n\n${body}\n\n</details>\n`;
  updateTasks(outDir, (t) => addToTask(setTaskLabel(t, messageId, INPUT_GIVEN), messageId, block));
}

const gitOk = (repoDir, args) => {
  try { execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' }); return true; } catch { return false; }
};

function patchState(repoDir, file) {
  if (gitOk(repoDir, ['apply', '--check', '--reverse', file])) return 'applied';
  return gitOk(repoDir, ['apply', '--check', file]) ? 'not applied' : 'conflicts';
}

/**
 * Completes every Awaiting apply task whose run's patch is already in the main files. Apply fix changes backend files,
 * so the dev server restarts and can cut the request off before the tasks are marked; this settles them afterwards.
 * Safe to repeat: the live Complete mark is skipped when it is already there.
 */
async function reconcileApplied({ settings, outDir = DEFAULT_OUT_DIR, repoDir, logger = console }) {
  const text = fs.existsSync(path.join(outDir, 'TASKS.md')) ? fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8') : '';
  const runs = [...new Set(taskBlocks(text).filter((r) => r.status === AWAITING && r.pendingRun).map((r) => r.pendingRun))];
  const done = [];
  for (const runId of runs) {
    const file = path.join(outDir, 'autofix', `${runId}.patch`);
    if (fs.existsSync(file) && patchState(repoDir, file) === 'applied') done.push(...await completeApplied({ settings, outDir, runId, logger }));
  }
  return done;
}

/**
 * One-time scan of the saved Auto-fix patches: a patch that is not in the main files moves the Complete tasks its run
 * marked back to Awaiting apply. The task comes from a "--mark complete" line in the run's log, else the first task id
 * the agent's summary names (later ids are the untouched next tasks). Reads git only; never applies or changes code.
 */
function flagUnapplied({ repoDir, outDir = DEFAULT_OUT_DIR, logger = console }) {
  const dir = path.join(outDir, 'autofix');
  const patches = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.patch')).sort() : [];
  const result = patches.map((patch) => {
    const file = path.join(dir, patch);
    const state = patchState(repoDir, file);
    const logFile = file.replace(/\.patch$/, '.log');
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    const marked = [...log.matchAll(/--mark complete((?:\s+[0-9a-f]{24})+)/g)].flatMap((m) => m[1].trim().split(/\s+/));
    const first = (/\b[0-9a-f]{24}\b/.exec(log) || [])[0];
    const tasks = [...new Set(marked.length ? marked : [first].filter(Boolean))];
    return { patch, state, tasks };
  });
  updateTasks(outDir, (text) => result.filter((r) => r.state !== 'applied').reduce((acc, r) => {
    const runId = r.patch.replace(/\.patch$/, '');
    return r.tasks.filter((id) => taskStatus(acc, id) === 'Complete').reduce((t, id) => setTaskLine(
      setTaskLabel(t, id, AWAITING), id, 'Pending patch',
      `Auto-fix run ${runId} — ${r.state}; not in the main files (client-reports/autofix/${r.patch}). Apply it, then run --applied ${runId}`,
    ), acc);
  }, text));
  result.forEach((r) => logger.log(`report-inbox: ${r.patch} ${r.state}${r.tasks.length ? ` · tasks ${r.tasks.join(', ')}` : ''}`));
  return result;
}

/** Pushes the saved issue / fix of every Complete task to its completed live update (run once after deploying). */
async function syncSummaries({ settings, outDir = DEFAULT_OUT_DIR, logger = console }) {
  const text = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
  const summaries = taskSummaries(text);
  const api = liveApi(settings);
  const result = { saved: [], skipped: [] };
  for (const row of taskBlocks(text).filter((r) => r.status === 'Complete' && r.messageId && r.hasSummary)) {
    const found = await findLiveMessage(api, row.messageId);
    const update = found?.message.update;
    const ok = update && ['done', 'confirmed'].includes(update.status)
      && await saveLiveSummary(api, found, update, summaries[row.messageId], logger);
    result[ok ? 'saved' : 'skipped'].push(row.messageId);
  }
  logger.log(`report-inbox: summaries saved on live for ${result.saved.length}, skipped ${result.skipped.length}`);
  return result;
}

/** Saves the stage and English reason on the open live update, so the client sees why it is not done. False when not saved. */
async function saveLiveReason(api, found, why, logger) {
  const update = found?.message.update;
  if (!update || ['done', 'confirmed'].includes(update.status)) return false;
  const url = `/support/threads/${encodeURIComponent(found.tenantId)}/updates/${encodeURIComponent(update.id)}`;
  try {
    await api.request('PATCH', url, { action: 'reason', stage: why.stage, reason: why.reason });
    return true;
  } catch (err) {
    logger.log(`report-inbox: reason not saved on live for ${found.message.id}: ${err.message}`);
    return false;
  }
}

/** Writes an English "- Reason:" line on the open task and saves it on its live update (messages nobody tracks stay untouched). */
async function saveReason({ settings, outDir = DEFAULT_OUT_DIR, messageId, reason = '', logger = console }) {
  const text = oneLine(reason);
  if (!text) throw new Error('Write the reason in English with --text "<why it is not done yet>"');
  if (text.length > REASON_MAX) throw new Error(`Keep the reason under ${REASON_MAX} characters`);
  const row = taskBlocks(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8')).find((r) => r.messageId === messageId);
  if (!row) throw new Error(`Task ${messageId} is not in the task list`);
  if (row.status === 'Complete') throw new Error(`Task ${messageId} is Complete; it has no pending reason`);
  updateTasks(outDir, (current) => setTaskLine(current, messageId, 'Reason', text));
  const why = taskReasons(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'))[messageId];
  const api = liveApi(settings);
  const saved = await saveLiveReason(api, await findLiveMessage(api, messageId), why, logger);
  logger.log(`report-inbox: reason for ${messageId} saved in the task list${saved ? ' and on live' : ' (not on live: untracked there or not supported yet)'}`);
}

/** Saves the stage and reason of every open task on its tracked live update. */
async function syncReasons({ settings, outDir = DEFAULT_OUT_DIR, logger = console }) {
  const reasons = taskReasons(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'));
  const api = liveApi(settings);
  const result = { saved: [], skipped: [] };
  for (const [messageId, why] of Object.entries(reasons)) {
    const ok = await saveLiveReason(api, await findLiveMessage(api, messageId), why, logger);
    result[ok ? 'saved' : 'skipped'].push(messageId);
  }
  logger.log(`report-inbox: reasons saved on live for ${result.saved.length}, skipped ${result.skipped.length}`);
  return result;
}

function updateTasks(outDir, change) {
  const tasksFile = path.join(outDir, 'TASKS.md');
  const current = fs.readFileSync(tasksFile, 'utf8');
  const next = withOverview(change(current));
  if (next !== current) fs.writeFileSync(tasksFile, next);
}

/**
 * The task needs something only the client can give: posts `question` to the client as a reply to their message,
 * shows In progress on that message in the live chat, and sets the task to Waiting for client with what is needed.
 */
async function askClient({ settings, outDir = DEFAULT_OUT_DIR, messageId, need = '', needHi = '', question = '', logger = console }) {
  const what = oneLine(need);
  const hindi = oneLine(needHi);
  const ask = String(question || '').trim();
  if (!what) throw new Error('Say what the client must provide with --need "<requirement>"');
  if (!ask) throw new Error('Write the question for the client with --question "<text>"');
  if (ask.length > QUESTION_MAX) throw new Error(`Keep the question under ${QUESTION_MAX} characters`);
  if (!taskBlocks(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8')).some((r) => r.messageId === messageId)) {
    throw new Error(`Task ${messageId} is not in the task list`);
  }
  const api = liveApi(settings);
  const found = await findLiveMessage(api, messageId);
  if (!found) throw new Error(`Message ${messageId} is not in the live Report chat`);
  await moveLive(api, found, 'in-progress');
  const sent = (await api.request('POST', `/support/threads/${encodeURIComponent(found.tenantId)}/messages`, { text: ask, replyTo: messageId })).data;
  const lines = `- Waiting for: ${what}\n${hindi ? `- Waiting for in Hinglish: ${hindi}\n` : ''}- Asked client: ${oneLine(ask)} (question id ${sent.id}, ${when(sent.createdAt || new Date())})\n`;
  updateTasks(outDir, (text) => addToTask(setTaskLabel(text, messageId, WAITING), messageId, lines));
  logger.log(`report-inbox: asked the client about ${messageId}; the task is now ${WAITING}`);
}

/** Folds a message found anywhere in the chat history into the task (collapsed, with its files); its own task becomes part of it. */
async function attachFound({ settings, outDir = DEFAULT_OUT_DIR, taskId, foundId, logger = console }) {
  const rows = taskBlocks(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'));
  if (!rows.some((r) => r.messageId === taskId)) throw new Error(`Task ${taskId} is not in the task list`);
  if (!foundId || foundId === taskId) throw new Error('Give the id of the message that holds the requirement');
  const api = liveApi(settings);
  const found = await findLiveMessage(api, foundId);
  if (!found) throw new Error(`Message ${foundId} is not in the live Report chat`);
  const files = await saveAttachment(api, found.message, outDir);
  const ownTask = rows.find((r) => r.messageId === foundId);
  updateTasks(outDir, (text) => {
    let next = addToTask(text, taskId, collapsed('Found in history', found.message, files, 'Found message id'));
    if (ownTask && !ownTask.partOf) next = addToTask(next, foundId, `- Part of: ${taskId}\n`);
    return next;
  });
  logger.log(`report-inbox: attached ${foundId} to task ${taskId}`);
}

/** Every message of every chat, oldest first, one line each (both sides, with reply ids), for searching. Reads only. */
async function printHistory({ settings, logger = console }) {
  const api = liveApi(settings);
  const threads = (await api.get('/support/threads')).data || [];
  for (const thread of threads) {
    if (!thread.lastMessage) continue;
    for (const m of await threadMessages(api, thread.tenantId, null)) {
      if (m.deleted) continue;
      const parts = [oneLine(m.text)];
      if (m.attachment) parts.push(`[${KIND_LABEL[m.attachment.kind] || 'File'}${m.attachment.name ? `: ${m.attachment.name}` : ''}]`);
      if (m.event) parts.push(`[${EVENT_LABEL[m.event.action] || 'Status changed'}: ${m.event.title || ''}]`);
      if (m.replyTo?.id) parts.push(`(reply to ${m.replyTo.id})`);
      const who = m.side === 'tenant' ? 'client' : 'developer';
      logger.log(`${m.id} · ${when(m.createdAt)} · ${thread.tenantName} · ${who} ${m.senderName || ''}: ${parts.filter(Boolean).join(' ')}`);
    }
  }
}

async function main(argv) {
  const settings = require('../src/config').supportLive;
  const outDir = process.env.REPORT_INBOX_DIR ? path.resolve(process.env.REPORT_INBOX_DIR) : DEFAULT_OUT_DIR;
  const flag = (name) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] || '' : '');
  const once = async (job) => {
    try {
      await job();
    } catch (err) {
      console.log(`REPORT_INBOX_ERROR ${err.message}`);
      process.exitCode = 1;
    }
  };
  if (argv.includes('--history')) return once(() => printHistory({ settings }));
  if (argv.includes('--sync-summaries')) return once(() => syncSummaries({ settings, outDir }));
  if (argv.includes('--sync-reasons')) return once(() => syncReasons({ settings, outDir }));
  if (argv.includes('--reason') && !argv.includes('--discard')) {
    return once(() => saveReason({ settings, outDir, messageId: flag('--reason'), reason: flag('--text') }));
  }
  if (argv.includes('--applied')) return once(() => completeApplied({ settings, outDir, runId: flag('--applied') }));
  if (argv.includes('--discard')) return once(async () => discardRun({ outDir, runId: flag('--discard'), reason: flag('--reason') }));
  if (argv.includes('--unclear')) {
    return once(async () => needInput({
      outDir,
      messageId: flag('--unclear'),
      unclear: flag('--need'),
      unclearHi: flag('--need-hi'),
      options: flag('--options').split('|').map((o) => o.trim()),
      from: flag('--from') || 'developer',
      during: flag('--during'),
    }));
  }
  if (argv.includes('--flag-unapplied')) return once(async () => flagUnapplied({ repoDir: path.resolve(__dirname, '../../..'), outDir }));
  if (argv.includes('--ask')) {
    return once(() => askClient({
      settings, outDir, messageId: flag('--ask'), need: flag('--need'), needHi: flag('--need-hi'), question: flag('--question'),
    }));
  }
  if (argv.includes('--attach')) {
    const at = argv.indexOf('--attach');
    return once(() => attachFound({ settings, outDir, taskId: argv[at + 1], foundId: argv[at + 2] }));
  }
  const markAt = argv.indexOf('--mark');
  if (markAt >= 0) {
    const noteAt = argv.indexOf('--note');
    const note = noteAt >= 0 ? argv[noteAt + 1] || '' : '';
    const valued = ['--note', '--issue', '--fix', '--check'];
    const ids = argv.slice(markAt + 2).filter((a, i, all) => !valued.includes(a) && !valued.includes(all[i - 1]));
    try {
      await markTasks({
        settings, outDir, mark: argv[markAt + 1], messageIds: ids, note, issue: flag('--issue'), fix: flag('--fix'), check: flag('--check'),
        pendingRun: process.env.REPORT_AUTOFIX_RUN || '',
      });
    } catch (err) {
      console.log(`REPORT_INBOX_ERROR ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }
  const watchAt = argv.indexOf('--watch');
  const minutes = watchAt >= 0 ? Math.max(1, Number(argv[watchAt + 1]) || 10) : 0;
  const check = async () => {
    try {
      await runOnce({ settings, outDir });
    } catch (err) {
      console.log(`REPORT_INBOX_ERROR ${err.message}`);
      if (!minutes) process.exitCode = 1;
    }
  };
  const loop = async () => {
    await check();
    if (minutes) setTimeout(loop, minutes * 60 * 1000);
  };
  await loop();
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  runOnce, markTasks, syncSummaries, completeApplied, discardRun, flagUnapplied, reconcileApplied, needInput, provideInput, inputRequests, nearbyTasks, taskArea, SCOPE_STATUSES, statusCounts, runTasks, holdRun, askClient, attachFound, printHistory, nextTask, pendingQueue, planAutofix, taskStatus, taskSummaries, taskReasons, saveReason, syncReasons, clientMessagesAfter, mediaFileName,
  taskEntry,
};
