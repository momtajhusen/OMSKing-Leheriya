process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const {
  runOnce, markTasks, askClient, attachFound, printHistory, planAutofix, nextTask, clientMessagesAfter, mediaFileName, syncSummaries,
  completeApplied, discardRun, flagUnapplied,
} = require('../scripts/reportInbox');

const PASSWORD = 'live-secret-pw';
const TENANT = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const oid = (n) => n.toString(16).padStart(24, '0');

function message(n, extra = {}) {
  return {
    id: oid(n), side: 'tenant', senderName: 'Leheriya Super Admin', text: `message ${n}`,
    attachment: null, event: null, deleted: false, createdAt: new Date(Date.UTC(2026, 10, 3, 15, n)).toISOString(), ...extra,
  };
}

/** Same transitions as ACTIONS in supportUpdates.service.js (developer side). */
const LIVE_ACTIONS = {
  start: { from: ['pending'], to: 'in_progress' },
  complete: { from: ['pending', 'in_progress'], to: 'done' },
  reopen: { from: ['done', 'confirmed'], to: 'pending' },
  summary: { from: ['done', 'confirmed'], to: null },
};

/** Stands in for the live API: records every request, pages messages and tracks updates like the real routes. */
function startFakeLive(messages, { oldServer = false } = {}) {
  const seen = [];
  const updates = new Map(messages.filter((m) => m.update).map((m) => [m.update.id, { ...m.update }]));
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => route(req, res, JSON.parse(Buffer.concat(chunks).toString() || '{}')));
  });
  function route(req, res, body) {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body });
    const json = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/v1/auth/login') {
      if (body.email !== 'dev@live.test' || body.password !== PASSWORD) return json(401, { success: false });
      return json(200, { success: true, data: { accessToken: 'live-access-token-xyz' } });
    }
    const updatesPath = `/api/v1/support/threads/${TENANT}/updates`;
    if (req.method === 'POST' && url.pathname === updatesPath) {
      const msg = messages.find((m) => m.id === body.messageId);
      if (!msg) return json(404, { success: false, message: 'Message not found' });
      if (msg.update) return json(409, { success: false, message: 'This message is already tracked as an update' });
      const update = { id: `u${updates.size + 1}`, status: 'pending' };
      updates.set(update.id, update);
      msg.update = { ...update };
      return json(201, { success: true, data: update });
    }
    if (req.method === 'PATCH' && url.pathname.startsWith(`${updatesPath}/`)) {
      const update = updates.get(url.pathname.slice(updatesPath.length + 1));
      const rule = !(oldServer && body.action === 'summary') && LIVE_ACTIONS[body.action];
      if (!update) return json(404, { success: false, message: 'Update not found' });
      if (!rule) return json(400, { success: false, message: 'Unknown action' });
      if (!rule.from.includes(update.status)) return json(400, { success: false, message: `Cannot ${body.action} an update that is ${update.status}` });
      if (rule.to) update.status = rule.to;
      else Object.assign(update, { issue: body.issue, fix: body.fix, area: body.area });
      messages.forEach((m) => { if (m.update?.id === update.id) m.update = { ...update }; });
      return json(200, { success: true, data: update });
    }
    if (req.method === 'POST' && url.pathname === `/api/v1/support/threads/${TENANT}/messages`) {
      const quoted = messages.find((m) => m.id === body.replyTo);
      const sent = {
        id: oid(500 + messages.length), side: 'platform', senderName: 'OMSKing Platform', text: body.text, attachment: null, event: null,
        deleted: false, createdAt: new Date(Date.UTC(2026, 10, 3, 18, 0)).toISOString(), replyTo: quoted ? { id: quoted.id, text: quoted.text } : null,
      };
      messages.push(sent);
      return json(201, { success: true, data: sent });
    }
    if (url.pathname.startsWith('/api/v1/support/media/')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(Buffer.from('png-bytes'));
    }
    if (req.headers.authorization !== 'Bearer live-access-token-xyz') return json(401, { success: false });
    if (url.pathname === '/api/v1/support/threads') {
      const last = messages[messages.length - 1];
      return json(200, {
        success: true,
        data: [
          { tenantId: TENANT, tenantName: 'PRDOSCO GLOBAL', unread: 1, lastMessage: last ? { id: last.id } : null },
          { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb', tenantName: 'Quiet Co', unread: 0, lastMessage: null },
        ],
      });
    }
    if (url.pathname === `/api/v1/support/threads/${TENANT}/messages`) {
      const limit = Number(url.searchParams.get('limit')) || 50;
      const before = url.searchParams.get('before');
      const older = messages.filter((m) => !before || m.id < before);
      const page = older.slice(-limit);
      return json(200, { success: true, data: page, meta: { hasMore: older.length > limit } });
    }
    return json(404, { success: false });
  }
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, seen, url: `http://127.0.0.1:${server.address().port}/api/v1`,
  })));
}

async function withLive(messages, run, liveOptions) {
  const live = await startFakeLive(messages, liveOptions);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-inbox-'));
  try {
    await run(live, outDir);
  } finally {
    live.server.closeAllConnections(); live.server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

const settings = (live) => ({ url: live.url, email: 'dev@live.test', password: PASSWORD });
const quiet = { log: () => {} };
const OVERVIEW_END = '<!-- status-overview:end -->';
const entriesOf = (text) => text.slice(text.indexOf(OVERVIEW_END) + OVERVIEW_END.length);

test('new tasks start as Not started and the overview at the top counts every status', async () => {
  const messages = [message(1, { text: 'channel order id | not master' }), message(2), message(3)];
  await withLive(messages, async (live, outDir) => {
    const file = path.join(outDir, 'TASKS.md');
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    const first = fs.readFileSync(file, 'utf8');
    assert.equal((first.match(/^### \[Not started\] /gm) || []).length, 3);
    assert.ok(first.indexOf('## Status overview') < first.indexOf('### [Not started]'), 'overview sits above the tasks');
    assert.match(first, /Complete 0 · In progress 0 · Not started 3 · Blocked 0 · Fix failed 0/);
    assert.match(first, /\| 1 \| Not started \| .+ \| channel order id \\\| not master \|/);

    const marked = first
      .replace('### [Not started]', '### [Complete]')
      .replace(/### \[Not started\](?=[^]*### \[Not started\])/, '### [In progress]');
    fs.writeFileSync(file, marked);
    const again = await runOnce({ settings: settings(live), outDir, logger: quiet });
    assert.equal(again.count, 0);
    const refreshed = fs.readFileSync(file, 'utf8');
    assert.match(refreshed, /Complete 1 · In progress 1 · Not started 1 · Blocked 0 · Fix failed 0/);
    assert.match(refreshed, /\| 1 \| Complete \|/);
    assert.match(refreshed, /\| 2 \| In progress \|/);
    assert.equal(entriesOf(refreshed), entriesOf(marked), 'refreshing the overview leaves the tasks untouched');
  });
});

test('starting and finishing a task sets In progress, then Complete, on that live chat message and in the task list', async () => {
  const messages = [message(1), message(2), message(3)];
  await withLive(messages, async (live, outDir) => {
    const file = path.join(outDir, 'TASKS.md');
    await runOnce({ settings: settings(live), outDir, logger: quiet });

    await markTasks({ settings: settings(live), outDir, mark: 'in-progress', messageIds: [oid(2)], logger: quiet });
    assert.equal(messages[1].update.status, 'in_progress');
    assert.equal(messages[0].update, undefined, 'messages without work stay unmarked');
    assert.equal(messages[2].update, undefined, 'messages without work stay unmarked');
    let tasks = fs.readFileSync(file, 'utf8');
    assert.match(tasks, new RegExp(`### \\[In progress\\] [^\\n]*\\n- Message: message 2`));
    assert.match(tasks, /Complete 0 · In progress 1 · Not started 2/);

    await markTasks({ settings: settings(live), outDir, mark: 'complete', messageIds: [oid(2)], logger: quiet });
    assert.equal(messages[1].update.status, 'done');
    tasks = fs.readFileSync(file, 'utf8');
    assert.match(tasks, new RegExp(`### \\[Complete\\] [^\\n]*\\n- Message: message 2`));
    assert.match(tasks, /Complete 1 · In progress 0 · Not started 2/);

    const writes = live.seen.filter((r) => r.method !== 'GET' && !r.url.endsWith('/auth/login'));
    assert.deepEqual(writes.map((r) => `${r.method} ${r.body.action || r.body.messageId}`), [
      `POST ${oid(2)}`, 'PATCH start', 'PATCH complete',
    ]);
  });
});

test('a task already complete is not marked again, and Blocked / Fix failed only change the task list', async () => {
  const messages = [message(1), message(2, { update: { id: 'u9', status: 'done' } })];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    await markTasks({ settings: settings(live), outDir, mark: 'complete', messageIds: [oid(2)], logger: quiet });
    await markTasks({ settings: settings(live), outDir, mark: 'blocked', messageIds: [oid(1)], logger: quiet });
    const writes = live.seen.filter((r) => r.method !== 'GET' && !r.url.endsWith('/auth/login'));
    assert.deepEqual(writes, []);
    const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.match(tasks, /### \[Blocked\] [^\n]*\n- Message: message 1/);
    assert.match(tasks, /### \[Complete\] [^\n]*\n- Message: message 2/);
    await assert.rejects(
      markTasks({ settings: settings(live), outDir, mark: 'done-ish', messageIds: [oid(1)], logger: quiet }),
      /Unknown status/,
    );
  });
});

test('only client messages after the last one seen become tasks', () => {
  const rows = [
    message(1),
    message(2, { side: 'platform' }),
    message(3, { deleted: true }),
    message(4, { event: { action: 'reopen', title: 'Amazon label', note: 'still failing' }, text: '' }),
    message(5),
  ];
  assert.deepEqual(clientMessagesAfter(rows, null).map((m) => m.id), [oid(1), oid(4), oid(5)]);
  assert.deepEqual(clientMessagesAfter(rows, oid(4)).map((m) => m.id), [oid(5)]);
});

test('downloaded file names stay inside the media folder', () => {
  const doc = message(7, { attachment: { kind: 'file', name: '../../etc/passwd', mime: 'application/octet-stream' } });
  const photo = message(8, { attachment: { kind: 'image', name: '', mime: 'image/jpeg' } });
  assert.doesNotMatch(mediaFileName(doc), /[/\\]|\.\./);
  assert.match(mediaFileName(photo), /\.jpg$/);
});

test('new client messages are added to the task list once, with their files, and nothing is marked read', async () => {
  const messages = [
    message(1, { attachment: { kind: 'image', url: `/api/v1/support/media/${oid(1)}?exp=1&sig=a`, mime: 'image/png', name: '' } }),
    message(2, { side: 'platform', text: 'developer reply' }),
    message(3, { text: 'Amazon label is not downloading' }),
  ];
  await withLive(messages, async (live, outDir) => {
    const first = await runOnce({ settings: settings(live), outDir, logger: quiet });
    assert.equal(first.count, 2);

    const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.match(tasks, /PRDOSCO GLOBAL/);
    assert.match(tasks, /message 1/);
    assert.match(tasks, /Amazon label is not downloading/);
    assert.doesNotMatch(tasks, /developer reply/);
    const photo = fs.readdirSync(path.join(outDir, 'media')).find((f) => f.endsWith('.png'));
    assert.ok(photo, 'photo downloaded');
    assert.equal(fs.readFileSync(path.join(outDir, 'media', photo), 'utf8'), 'png-bytes');
    assert.match(tasks, new RegExp(`media/${photo}`));

    const again = await runOnce({ settings: settings(live), outDir, logger: quiet });
    assert.equal(again.count, 0);
    assert.equal(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'), tasks);

    messages.push(message(4, { text: 'custom date period please' }));
    const later = await runOnce({ settings: settings(live), outDir, logger: quiet });
    assert.equal(later.count, 1);
    const updated = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.ok(entriesOf(updated).startsWith(entriesOf(tasks)), 'earlier tasks and notes are kept as they were');
    assert.match(updated, /custom date period please/);

    const writes = live.seen.filter((r) => r.method !== 'GET' && !r.url.endsWith('/auth/login'));
    assert.deepEqual(writes, [], 'only reads are sent to live');
    assert.ok(!live.seen.some((r) => r.url.includes('/read')), 'nothing is marked read');
    assert.ok(!live.seen.some((r) => r.url.includes('/bbbbbbbbbbbbbbbbbbbbbbbb/')), 'empty chats are not fetched');
  });
});

test('the login token is never written to the task list or the saved state', async () => {
  await withLive([message(1)], async (live, outDir) => {
    const lines = [];
    await runOnce({ settings: settings(live), outDir, logger: { log: (l) => lines.push(l) } });
    const written = fs.readdirSync(outDir).filter((f) => f !== 'media')
      .map((f) => fs.readFileSync(path.join(outDir, f), 'utf8')).join('\n') + lines.join('\n');
    assert.doesNotMatch(written, /live-access-token-xyz/);
    assert.doesNotMatch(written, new RegExp(PASSWORD));
  });
});

test('missing live developer login gives a clear message', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-inbox-'));
  try {
    await assert.rejects(
      runOnce({ settings: { url: 'http://127.0.0.1:9/api/v1', email: '', password: '' }, outDir, logger: quiet }),
      /SUPPORT_LIVE_EMAIL and SUPPORT_LIVE_PASSWORD/,
    );
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

const liveWrites = (live) => live.seen.filter((r) => r.method !== 'GET' && !r.url.endsWith('/auth/login'));
const headingOf = (tasks, id) => {
  const at = tasks.indexOf(`- Message id: ${id}`);
  return tasks.slice(tasks.lastIndexOf('\n### ', at) + 1).split('\n')[0];
};

test('asking the client sets Waiting for client, posts one question as a reply to that message and shows In progress on live', async () => {
  const messages = [message(1), message(2, { text: 'Inventory page is not opening' })];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    const question = 'Could you send a screenshot of the Inventory filters you use?';
    await askClient({ settings: settings(live), outDir, messageId: oid(2), need: 'Inventory filter screenshot', question, logger: quiet });

    const writes = liveWrites(live);
    assert.deepEqual(writes.map((r) => `${r.method} ${r.url.split('/').pop()} ${r.body.action || r.body.messageId || r.body.replyTo}`), [
      `POST updates ${oid(2)}`, 'PATCH u1 start', `POST messages ${oid(2)}`,
    ]);
    assert.equal(writes[2].body.text, question);
    const asked = messages[messages.length - 1];

    const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.match(headingOf(tasks, oid(2)), /^### \[Waiting for client\] /);
    assert.match(tasks, /- Waiting for: Inventory filter screenshot/);
    assert.match(tasks, new RegExp(`- Asked client: Could you send a screenshot of the Inventory filters you use\\? \\(question id ${asked.id}, `));
    assert.match(tasks, /Waiting for client 1/);
    assert.equal(nextTask(tasks).messageId, oid(1), 'a waiting task never blocks the next one');

    await assert.rejects(askClient({ settings: settings(live), outDir, messageId: oid(1), need: '', question: 'x', logger: quiet }), /--need/);
    await assert.rejects(askClient({ settings: settings(live), outDir, messageId: oid(1), need: 'x', question: ' ', logger: quiet }), /--question/);
  });
});

test('a client reply to the question is attached collapsed under the waiting task, which becomes Client replied', async () => {
  const messages = [message(1), message(2)];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    await askClient({ settings: settings(live), outDir, messageId: oid(2), need: 'export file', question: 'Please send the export file', logger: quiet });
    const asked = messages[messages.length - 1];
    const before = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    const writesBefore = liveWrites(live).length;

    messages.push(message(20, {
      text: 'here is the file', replyTo: { id: asked.id, text: asked.text },
      attachment: { kind: 'image', url: `/api/v1/support/media/${oid(20)}?exp=1&sig=a`, mime: 'image/png', name: '' },
    }));
    messages.push(message(21, { text: 'unrelated new issue' }));
    await runOnce({ settings: settings(live), outDir, logger: quiet });

    const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.match(headingOf(tasks, oid(2)), /^### \[Client replied\] /);
    assert.match(tasks, /<details><summary>Client reply · [^<]+ · here is the file<\/summary>/);
    assert.match(tasks, new RegExp(`- Reply message id: ${oid(20)}`));
    assert.match(tasks, /- Photo: \[media\/[^\]]+\.png\]/);
    assert.equal((tasks.match(/^### /gm) || []).length, (before.match(/^### /gm) || []).length + 1, 'the reply is not a new task; the unrelated message is');
    assert.match(headingOf(tasks, oid(21)), /^### \[Not started\] /);
    assert.equal(liveWrites(live).length, writesBefore, 'checking the inbox still only reads');
  });
});

test('a requirement found in the history is collapsed under the task with its details and its own task becomes part of it', async () => {
  const messages = [message(1, { text: 'Inventory page is not opening' }), message(2, { text: 'we filter by warehouse WH-002 only' })];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    await attachFound({ settings: settings(live), outDir, taskId: oid(1), foundId: oid(2), logger: quiet });

    const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.match(tasks, /<details><summary>Found in history · [^<]+ · we filter by warehouse WH-002 only<\/summary>/);
    assert.match(tasks, new RegExp(`- Found message id: ${oid(2)}`));
    assert.match(tasks, new RegExp(`- Part of: ${oid(1)}`));
    assert.equal(nextTask(tasks).messageId, oid(1));
    fs.writeFileSync(path.join(outDir, 'TASKS.md'), tasks.replace('### [Not started]', '### [Complete]'));
    assert.equal(nextTask(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8')), null, 'a task that is part of another is not picked on its own');
    assert.deepEqual(liveWrites(live), []);
  });
});

test('--history prints every message of every chat, both sides, with reply ids, and only reads', async () => {
  const messages = [message(1, { text: 'first issue' }), message(2, { side: 'platform', text: 'which page?', replyTo: { id: oid(1) } })];
  await withLive(messages, async (live) => {
    const lines = [];
    await printHistory({ settings: settings(live), logger: { log: (l) => lines.push(l) } });
    const out = lines.join('\n');
    assert.match(out, new RegExp(`${oid(1)} · .* · PRDOSCO GLOBAL · client Leheriya Super Admin: first issue`));
    assert.match(out, new RegExp(`${oid(2)} · .* · PRDOSCO GLOBAL · developer [^:]+: which page\\? \\(reply to ${oid(1)}\\)`));
    assert.deepEqual(liveWrites(live), []);
  });
});

function plannedTasks(entries) {
  return entries.map(([label, n, extra = '']) => `### [${label}] 3 Nov 2026, ${n}:00 pm · Co · Client\n- Message: issue ${n}\n${extra}- Message id: ${oid(n)}\n`).join('\n');
}

test('each Auto-fix click checks in strict order: client replied, then waiting tasks against the history, then the next pending', () => {
  const waiting = ['Waiting for client', 3, `- Waiting for: export file\n- Asked client: send it (question id ${oid(90)}, 3 Nov)\n`];
  assert.deepEqual(planAutofix(plannedTasks([['Complete', 1], waiting, ['Client replied', 4, '- Waiting for: logo\n'], ['Not started', 5]])), {
    kind: 'replied', task: { messageId: oid(4), message: 'issue 4', need: 'logo' }, next: { messageId: oid(5), message: 'issue 5' },
  });
  assert.deepEqual(planAutofix(plannedTasks([['Complete', 1], waiting, ['Not started', 5], ['Not started', 6]])), {
    kind: 'waiting', waiting: [{ messageId: oid(3), message: 'issue 3', need: 'export file', questionId: oid(90) }], next: { messageId: oid(5), message: 'issue 5' },
  });
  assert.deepEqual(planAutofix(plannedTasks([['Complete', 1], ['Not started', 5], ['Not started', 6]])), {
    kind: 'next', task: { messageId: oid(5), message: 'issue 5' }, next: { messageId: oid(6), message: 'issue 6' },
  });
  assert.equal(planAutofix(plannedTasks([['Complete', 1]])), null);
});

const { taskSummaries } = require('../scripts/reportInbox');

test('completing a task can save a short Hinglish issue and fix, which become its summary', async () => {
  const messages = [message(1, { text: 'Assign button chahiye' }), message(2)];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    await markTasks({
      settings: settings(live), outDir, mark: 'complete', messageIds: [oid(1)], logger: quiet,
      issue: 'Vendor dropdown khaali tha, Assign button nahi tha', fix: 'Row ke right me Assign button lagaya',
    });
    const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.match(tasks, /- Issue: Vendor dropdown khaali tha, Assign button nahi tha\n- Fix: Row ke right me Assign button lagaya\n- Message id: /);
    assert.deepEqual(taskSummaries(tasks), {
      [oid(1)]: { issue: 'Vendor dropdown khaali tha, Assign button nahi tha', fix: 'Row ke right me Assign button lagaya', area: '' },
    });

    await markTasks({ settings: settings(live), outDir, mark: 'complete', messageIds: [oid(1)], logger: quiet, fix: 'Assign button aur hint lagaya' });
    const again = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.equal((again.match(/^- Fix: /gm) || []).length, 1, 'the fix line is replaced, not repeated');
    assert.equal(taskSummaries(again)[oid(1)].fix, 'Assign button aur hint lagaya');
  });
});

test('summaries cover only Complete tasks; parts share their task\'s summary; older tasks fall back to the message and status', () => {
  const block = (label, n, extra) => `### [${label}] 3 Nov 2026, ${n}:00 pm · Co · Client\n- Message: issue ${n}\n- Type: Bug (Stock → Inventory)\n${extra}- Message id: ${oid(n)}\n`;
  const text = [
    block('Complete', 1, '- Issue: Page load nahi ho raha tha\n- Fix: Query halki ki\n'),
    block('Complete', 2, '- Status: Fixed and verified 3 Nov 2026 — the inventory list now loads in pages\n'),
    block('In progress', 3, '- Issue: x\n- Fix: y\n'),
    block('Complete', 4, `- Part of: ${oid(1)}\n`),
  ].join('\n');
  assert.deepEqual(taskSummaries(text), {
    [oid(1)]: { issue: 'Page load nahi ho raha tha', fix: 'Query halki ki', area: 'Stock → Inventory' },
    [oid(2)]: { issue: 'issue 2', fix: 'the inventory list now loads in pages', area: 'Stock → Inventory' },
    [oid(4)]: { issue: 'Page load nahi ho raha tha', fix: 'Query halki ki', area: 'Stock → Inventory' },
  });
});

const writesOf = (live) => live.seen.filter((r) => r.method !== 'GET' && !r.url.endsWith('/auth/login')).map((r) => `${r.method} ${r.body.action || r.body.messageId}`);
const summaryWrites = (live) => live.seen.filter((r) => r.method === 'PATCH' && r.body.action === 'summary').map((r) => r.body);
const typed = (outDir, n, type) => {
  const file = path.join(outDir, 'TASKS.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`- Message: message ${n}\n- Type: _to triage_`, `- Message: message ${n}\n- Type: ${type}`));
};

test('completing with an issue and fix also saves them on the live update, so the live chat and side list show the hover', async () => {
  const messages = [message(1), message(2)];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    typed(outDir, 2, 'Bug (Stock → Inventory)');
    await markTasks({
      settings: settings(live), outDir, mark: 'complete', messageIds: [oid(2)], logger: quiet,
      issue: 'Inventory page atak jaata tha', fix: 'Inventory API halki ki',
    });
    assert.equal(messages[1].update.status, 'done');
    assert.deepEqual(summaryWrites(live), [{ action: 'summary', issue: 'Inventory page atak jaata tha', fix: 'Inventory API halki ki', area: 'Stock → Inventory' }]);
    assert.equal(messages[1].update.fix, 'Inventory API halki ki');
  });
});

test('a live server without summary support still completes the task and keeps the summary in the task list', async () => {
  const messages = [message(1)];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    const logs = [];
    await markTasks({
      settings: settings(live), outDir, mark: 'complete', messageIds: [oid(1)], logger: { log: (l) => logs.push(l) },
      issue: 'Page atak jaata tha', fix: 'API halki ki',
    });
    assert.equal(messages[0].update.status, 'done');
    assert.match(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'), /- Fix: API halki ki\n/);
    assert.ok(logs.some((l) => /summary not saved on live/.test(l)), logs.join('\n'));
  }, { oldServer: true });
});

test('syncSummaries pushes the issue and fix of every Complete task to its live update, once deployed', async () => {
  const messages = [message(1, { update: { id: 'u9', status: 'done' } }), message(2), message(3, { update: { id: 'u8', status: 'in_progress' } })];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    const file = path.join(outDir, 'TASKS.md');
    let text = fs.readFileSync(file, 'utf8');
    for (const n of [1, 3]) {
      text = text.replace(new RegExp(`### \\[Not started\\]([^\\n]*\\n- Message: message ${n}\\n)`), '### [Complete]$1');
      text = text.replace(`- Message id: ${oid(n)}`, `- Issue: issue ${n} tha\n- Fix: fix ${n} kiya\n- Message id: ${oid(n)}`);
    }
    fs.writeFileSync(file, text);
    typed(outDir, 1, 'Change (Orders list)');
    const result = await syncSummaries({ settings: settings(live), outDir, logger: quiet });
    assert.deepEqual(summaryWrites(live), [{ action: 'summary', issue: 'issue 1 tha', fix: 'fix 1 kiya', area: 'Orders list' }]);
    assert.deepEqual(result, { saved: [oid(1)], skipped: [oid(3)] }, 'a live update that is not done yet is left alone');
  });
});


test('inside an Auto-fix run, complete only sets Awaiting apply: the live chat is not marked until the fix is applied', async () => {
  const messages = [message(1), message(2)];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    await markTasks({ settings: settings(live), outDir, mark: 'in-progress', messageIds: [oid(1)], logger: quiet });
    await markTasks({
      settings: settings(live), outDir, mark: 'complete', messageIds: [oid(1)], logger: quiet,
      issue: 'Page atak jaata tha', fix: 'API halki ki', pendingRun: 'run-7',
    });
    const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.match(tasks, /### \[Awaiting apply\] [^\n]*\n- Message: message 1\n/);
    assert.match(tasks, /- Pending patch: Auto-fix run run-7 — apply it with the header Apply fix button\n/);
    assert.match(tasks, /- Fix: API halki ki\n/);
    assert.match(tasks, /Awaiting apply 1/, 'the overview counts it');
    assert.equal(messages[0].update.status, 'in_progress', 'the live chat still shows In progress');
    assert.deepEqual(writesOf(live), [`POST ${oid(1)}`, 'PATCH start']);
  });
});

test('once the fix is applied, its Awaiting apply tasks become Complete in the task list and the live chat', async () => {
  const messages = [message(1), message(2), message(3)];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    await markTasks({ settings: settings(live), outDir, mark: 'complete', messageIds: [oid(1)], logger: quiet, issue: 'i1', fix: 'f1', pendingRun: 'run-7' });
    await markTasks({ settings: settings(live), outDir, mark: 'complete', messageIds: [oid(2)], logger: quiet, pendingRun: 'run-8' });
    const done = await completeApplied({ settings: settings(live), outDir, runId: 'run-7', logger: quiet });
    assert.deepEqual(done, [oid(1)]);
    const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.match(tasks, /### \[Complete\] [^\n]*\n- Message: message 1\n/);
    assert.doesNotMatch(tasks, /Pending patch: Auto-fix run run-7/);
    assert.match(tasks, /### \[Awaiting apply\] [^\n]*\n- Message: message 2\n/, 'another run\'s task stays waiting');
    assert.equal(messages[0].update.status, 'done');
    assert.deepEqual(summaryWrites(live), [{ action: 'summary', issue: 'i1', fix: 'f1', area: '' }]);
    assert.equal(messages[1].update, undefined);
  });
});

test('a discarded fix moves its tasks to Fix failed with the reason, and never touches the live chat', async () => {
  const messages = [message(1)];
  await withLive(messages, async (live, outDir) => {
    await runOnce({ settings: settings(live), outDir, logger: quiet });
    await markTasks({ settings: settings(live), outDir, mark: 'complete', messageIds: [oid(1)], logger: quiet, pendingRun: 'run-7' });
    assert.throws(() => discardRun({ outDir, runId: 'run-7', reason: '  ' }), /reason/);
    assert.deepEqual(discardRun({ outDir, runId: 'run-7', reason: 'Patch conflicts with the new tabs' }), [oid(1)]);
    const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.match(tasks, /### \[Fix failed\] [^\n]*\n- Message: message 1\n/);
    assert.match(tasks, /- Status: .* — Auto-fix change discarded, not applied: Patch conflicts with the new tabs\n/);
    assert.doesNotMatch(tasks, /Pending patch/);
    assert.deepEqual(writesOf(live), []);
  });
});

test('the one-time scan flags Complete tasks whose Auto-fix patch never reached the main files', () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-repo-'));
  const outDir = path.join(repoDir, 'client-reports');
  const run = (...a) => require('child_process').execFileSync('git', a, { cwd: repoDir, encoding: 'utf8' });
  try {
    run('init', '-q');
    fs.writeFileSync(path.join(repoDir, '.gitignore'), 'client-reports/\n');
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\n');
    fs.writeFileSync(path.join(repoDir, 'b.txt'), 'one\n');
    run('add', '.');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
    fs.mkdirSync(path.join(outDir, 'autofix'), { recursive: true });
    const patchOf = (file, name, log) => {
      fs.appendFileSync(path.join(repoDir, file), 'two\n');
      fs.writeFileSync(path.join(outDir, 'autofix', `${name}.patch`), `${run('diff')}\n`);
      run('checkout', '--', file);
      fs.writeFileSync(path.join(outDir, 'autofix', `${name}.log`), log);
    };
    patchOf('a.txt', 'run-applied', `npm run report-inbox -- --mark complete ${oid(1)}\n`);
    patchOf('b.txt', 'run-lost', `\nI fixed task ${oid(2)} and marked it Complete.\n- **${oid(3)}:** untouched, still Not started.\n`);
    fs.appendFileSync(path.join(repoDir, 'a.txt'), 'two\n');
    const block = (n) => `### [Complete] 3 Nov 2026, ${n}:00 pm · Co · Client\n- Message: issue ${n}\n- Message id: ${oid(n)}\n`;
    fs.writeFileSync(path.join(outDir, 'TASKS.md'), `# tasks\n\n${block(1)}\n${block(2)}\n${block(3)}`);

    const result = flagUnapplied({ repoDir, outDir, logger: quiet });
    assert.deepEqual(result, [
      { patch: 'run-applied.patch', state: 'applied', tasks: [oid(1)] },
      { patch: 'run-lost.patch', state: 'not applied', tasks: [oid(2)] },
    ]);
    const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
    assert.match(tasks, /### \[Complete\] [^\n]*\n- Message: issue 1\n/);
    assert.match(tasks, /### \[Awaiting apply\] [^\n]*\n- Message: issue 2\n- Pending patch: Auto-fix run run-lost — /);
    assert.match(tasks, /### \[Complete\] [^\n]*\n- Message: issue 3\n/, 'a task the log only mentions as untouched is left alone');
    assert.equal(fs.readFileSync(path.join(repoDir, 'b.txt'), 'utf8'), 'one\n', 'the scan never applies anything');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
