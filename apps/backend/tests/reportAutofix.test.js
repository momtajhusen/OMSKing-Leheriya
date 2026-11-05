process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const express = require('express');
const { nextTask, taskStatus } = require('../scripts/reportInbox');
const { createReportAutofix } = require('../src/services/reportAutofix');

const oid = (n) => n.toString(16).padStart(24, '0');
const DEAD_PID = 99999;

function entry(label, n) {
  return `### [${label}] 3 Nov 2026, ${n}:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue ${n}\n- Type: Bug\n- Notes:\n- Message id: ${oid(n)}\n`;
}

const TASKS = `# Client report tasks

<!-- status-overview:start -->
## Status overview
<!-- status-overview:end -->

${[entry('Not started', 1), entry('Complete', 2), entry('Not started', 3), entry('Complete', 4), entry('In progress', 5), entry('Not started', 6), entry('Not started', 7)].join('\n')}`;

test('nextTask picks the first Not started task after the last Complete one', () => {
  assert.deepEqual(nextTask(TASKS), { messageId: oid(6), time: '3 Nov 2026, 6:00 pm', message: 'issue 6' });
});

test('nextTask starts from the top when nothing is Complete and is null when nothing is left', () => {
  assert.equal(nextTask(`${entry('In progress', 1)}\n${entry('Not started', 2)}`).messageId, oid(2));
  assert.equal(nextTask(`${entry('Not started', 1)}\n${entry('Complete', 2)}`).messageId, oid(1), 'tasks above the last Complete are still pending');
  assert.equal(nextTask(`${entry('Complete', 1)}\n${entry('Waiting for client', 2)}`), null);
  assert.equal(nextTask(''), null);
});

test('with only waiting tasks ahead, the preview points at the pending task the run fixes when nobody answered', async (t) => {
  const outDir = tempDir(t, 'autofix-');
  fs.writeFileSync(path.join(outDir, 'TASKS.md'), `${entry('Not started', 1)}\n${entry('Waiting for client', 2)}\n${entry('Complete', 3)}`);
  const app = await serve(t, { outDir, spawn: fakeSpawn().spawn, reconcileTasks: async () => [] });
  const { data } = await (await app.call('GET')).json();
  assert.equal(data.next.kind, 'waiting');
  assert.equal(data.next.waiting, 1);
  assert.equal(data.next.messageId, oid(1));
});

test('taskStatus reads the label of one task', () => {
  assert.equal(taskStatus(TASKS, oid(4)), 'Complete');
  assert.equal(taskStatus(TASKS, oid(99)), null);
});

function fakeSpawn(pid = process.pid) {
  const calls = [];
  const spawn = (bin, args, options) => {
    const child = new EventEmitter();
    child.pid = pid;
    child.unref = () => { child.unrefed = true; };
    calls.push({ bin, args, options, child });
    return child;
  };
  return { spawn, calls };
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** An app with the Auto-fix route; `restart()` builds a fresh router on the same folders, like a backend restart. */
async function serve(t, options = {}) {
  const outDir = options.outDir || tempDir(t, 'autofix-');
  if (!fs.existsSync(path.join(outDir, 'TASKS.md'))) fs.writeFileSync(path.join(outDir, 'TASKS.md'), TASKS);
  const settings = { enabled: true, agentBin: '/bin/agent', repoDir: '/repo', worktreeRoot: '/worktrees', ...options, outDir };
  let router = createReportAutofix(settings);
  const app = express();
  app.use(express.json());
  app.use('/autofix', (req, res, next) => router(req, res, next));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  /** http.request rather than fetch, which ignores a custom Host header. */
  const call = (method, host, route = '', body) => new Promise((resolve, reject) => {
    const headers = { ...(host ? { host } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
    const req = http.request({ host: '127.0.0.1', port, path: `/autofix${route}`, method, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  const restart = (more = {}) => { router = createReportAutofix({ ...settings, ...more }); };
  const runFile = path.join(outDir, 'autofix', 'current.json');
  return { call, outDir, restart, runFile, readRun: () => JSON.parse(fs.readFileSync(runFile, 'utf8')) };
}

test('the route is hidden unless it is enabled and the request comes from localhost', async (t) => {
  const off = await serve(t, { enabled: false, spawn: fakeSpawn().spawn });
  assert.equal((await off.call('GET')).status, 404);

  const { spawn, calls } = fakeSpawn();
  const on = await serve(t, { spawn });
  assert.equal((await on.call('POST', 'omskingapi.codersalpha.com')).status, 404);
  assert.equal(calls.length, 0);
  assert.equal((await on.call('GET', 'localhost:5002')).status, 200);
});

test('POST saves the run to a file and starts a detached runner, which checks the inbox and picks the work itself', async (t) => {
  const { spawn, calls } = fakeSpawn();
  const { call, readRun, outDir } = await serve(t, { spawn, env: { PATH: '/usr/bin', HOME: '/home/dev', CURSOR_API_KEY: 'cursor-key', JWT_ACCESS_SECRET: 'jwt' } });

  const res = await call('POST');
  assert.equal(res.status, 202);
  const { data } = await res.json();
  assert.equal(data.running, true);
  assert.equal(data.state, 'starting');

  assert.equal(calls.length, 1);
  const { bin, args, options, child } = calls[0];
  assert.equal(bin, process.execPath);
  assert.match(args[0], /scripts[/\\]autofixRunner\.js$/);
  assert.equal(options.detached, true, 'a backend restart must not take the agent down with it');
  assert.equal(child.unrefed, true);
  assert.ok(!args.join(' ').includes('cursor-key'), 'the API key must not be on the command line');
  assert.equal(options.env.CURSOR_API_KEY, 'cursor-key');
  assert.equal(options.env.JWT_ACCESS_SECRET, undefined, 'backend secrets stay out of the agent environment');

  const saved = readRun();
  assert.equal(args[1], path.join(path.dirname(saved.logFile), 'current.json'));
  assert.equal(args[2], '--launch', 'the runner is handed to a grandchild, outside the dev server process tree');
  assert.equal(saved.outDir, outDir);
  assert.equal(saved.runnerPid, process.pid);
  assert.ok(saved.worktree.startsWith('/worktrees/'), 'the agent works outside the main checkout');
  assert.ok(!JSON.stringify(saved).includes('cursor-key'));
});

test('GET previews what the next click works on, waiting tasks first, and lists every task the run touched', async (t) => {
  const { spawn } = fakeSpawn();
  const app = await serve(t, { spawn });
  let { next } = (await (await app.call('GET')).json()).data;
  assert.deepEqual(next, { kind: 'resume', messageId: oid(5), message: 'issue 5', area: '', waiting: 0 }, 'the task left In progress comes first');

  const waiting = TASKS.replace(
    `[Not started] 3 Nov 2026, 3:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 3\n`,
    `[Client replied] 3 Nov 2026, 3:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 3\n- Waiting for: logo\n`,
  );
  fs.writeFileSync(path.join(app.outDir, 'TASKS.md'), waiting);
  ({ next } = (await (await app.call('GET')).json()).data);
  assert.deepEqual(next, { kind: 'replied', messageId: oid(3), message: 'issue 3', area: '', waiting: 0 });

  await app.call('POST');
  fs.writeFileSync(app.runFile, JSON.stringify({ ...app.readRun(), messageId: oid(3), message: 'issue 3', candidates: [oid(3), oid(6)] }));
  const { run } = (await (await app.call('GET')).json()).data;
  assert.deepEqual(run.tasks, [{ messageId: oid(3), status: 'Client replied' }, { messageId: oid(6), status: 'Not started' }]);
});

test('after a backend restart the button still finds the running fix and refuses a second one', async (t) => {
  const { spawn, calls } = fakeSpawn();
  const app = await serve(t, { spawn });
  await app.call('POST');

  const started = app.readRun().id;
  app.restart();
  const { run } = (await (await app.call('GET')).json()).data;
  assert.equal(run.id, started);
  assert.equal(run.running, true);
  assert.equal((await app.call('POST')).status, 409);
  assert.equal(calls.length, 1);
});

test('a finished run reports the task status and the saved fix; a runner that died is reported, not left spinning', async (t) => {
  const { spawn } = fakeSpawn(DEAD_PID);
  const app = await serve(t, { spawn });
  await app.call('POST');
  const { run } = (await (await app.call('GET')).json()).data;
  assert.equal(run.running, false);
  assert.match(run.error, /stopped before the agent finished/);

  fs.writeFileSync(app.runFile, JSON.stringify({ ...app.readRun(), messageId: oid(6), state: 'finished', exitCode: 0, error: '', patchFile: '/tmp/fix.patch' }));
  fs.writeFileSync(path.join(app.outDir, 'TASKS.md'), TASKS.replace('[Not started] 3 Nov 2026, 6:00', '[Complete] 3 Nov 2026, 6:00'));
  const data = (await (await app.call('GET')).json()).data;
  assert.equal(data.run.status, 'Complete');
  assert.equal(data.run.patchFile, '/tmp/fix.patch');
  assert.equal(data.run.applied, false);
  assert.equal(data.next.messageId, oid(5), 'the task left In progress is resumed before the next pending one');
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('Apply fix puts the saved patch into the main checkout once', async (t) => {
  const repoDir = tempDir(t, 'autofix-repo-');
  git(repoDir, 'init', '-q');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\n');
  git(repoDir, 'add', '.');
  git(repoDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\ntwo\n');
  const patchFile = path.join(tempDir(t, 'autofix-patch-'), 'fix.patch');
  fs.writeFileSync(patchFile, `${git(repoDir, 'diff')}\n`);
  git(repoDir, 'checkout', '--', 'a.txt');

  const app = await serve(t, { repoDir, spawn: fakeSpawn().spawn });
  assert.equal((await app.call('POST', null, '/apply')).status, 409, 'nothing to apply yet');
  fs.mkdirSync(path.dirname(app.runFile), { recursive: true });
  fs.writeFileSync(app.runFile, JSON.stringify({ id: 'r1', messageId: oid(6), message: 'issue 6', state: 'finished', exitCode: 0, patchFile }));

  const res = await app.call('POST', null, '/apply');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.applied, true);
  assert.equal(fs.readFileSync(path.join(repoDir, 'a.txt'), 'utf8'), 'one\ntwo\n');
  assert.equal(git(repoDir, 'diff', '--cached', '--name-only'), '', 'the main index is left alone');
  assert.equal((await app.call('POST', null, '/apply')).status, 409, 'a fix is applied only once');
});

test('Apply fix marks the tasks Complete before the patch lands, so a dev-server restart from the change cannot lose it', async (t) => {
  const repoDir = tempDir(t, 'autofix-repo-');
  git(repoDir, 'init', '-q');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\n');
  git(repoDir, 'add', '.');
  git(repoDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\ntwo\n');
  const patchFile = path.join(tempDir(t, 'autofix-patch-'), 'fix.patch');
  fs.writeFileSync(patchFile, `${git(repoDir, 'diff')}\n`);
  git(repoDir, 'checkout', '--', 'a.txt');

  const seen = [];
  const completeTasks = async () => { seen.push(fs.readFileSync(path.join(repoDir, 'a.txt'), 'utf8')); return [oid(6)]; };
  const app = await serve(t, { repoDir, spawn: fakeSpawn().spawn, completeTasks, reconcileTasks: async () => [] });
  fs.mkdirSync(path.dirname(app.runFile), { recursive: true });
  fs.writeFileSync(app.runFile, JSON.stringify({ id: 'r1', messageId: oid(6), message: 'issue 6', state: 'finished', exitCode: 0, patchFile }));
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'changed\n');
  assert.equal((await app.call('POST', null, '/apply')).status, 409, 'a patch that does not apply marks nothing');
  assert.deepEqual(seen, []);

  git(repoDir, 'checkout', '--', 'a.txt');
  const res = await app.call('POST', null, '/apply');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data.completed, [oid(6)]);
  assert.deepEqual(seen, ['one\n'], 'Complete is saved while the files are still untouched');
  assert.equal(fs.readFileSync(path.join(repoDir, 'a.txt'), 'utf8'), 'one\ntwo\n');
});

test('the next task and the running task carry their area, so the admin can open that page', async (t) => {
  const outDir = tempDir(t, 'autofix-');
  fs.writeFileSync(path.join(outDir, 'TASKS.md'), TASKS.replace('- Message: issue 5\n- Type: Bug\n', '- Message: issue 5\n- Type: Bug (Orders list)\n'));
  const app = await serve(t, { outDir, spawn: fakeSpawn().spawn, reconcileTasks: async () => [] });
  let { data } = await (await app.call('GET')).json();
  assert.equal(data.next.messageId, oid(5));
  assert.equal(data.next.area, 'Orders list');
  fs.mkdirSync(path.dirname(app.runFile), { recursive: true });
  fs.writeFileSync(app.runFile, JSON.stringify({ id: 'r1', messageId: oid(5), message: 'issue 5', state: 'running', runnerPid: process.pid }));
  ({ data } = await (await app.call('GET')).json());
  assert.equal(data.run.area, 'Orders list');
});

test('GET /summaries gives the issue and fix of each completed task, localhost only', async (t) => {
  const done = TASKS.replace(
    `[Complete] 3 Nov 2026, 2:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 2\n`,
    `[Complete] 3 Nov 2026, 2:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 2\n- Issue: Button nahi tha\n- Fix: Button lagaya\n`,
  );
  const outDir = tempDir(t, 'autofix-');
  fs.writeFileSync(path.join(outDir, 'TASKS.md'), done);
  const app = await serve(t, { outDir, spawn: fakeSpawn().spawn });
  const { data } = await (await app.call('GET', null, '/summaries')).json();
  assert.deepEqual(data[oid(2)], { issue: 'Button nahi tha', fix: 'Button lagaya', area: '' });
  assert.deepEqual(data[oid(4)], { issue: 'issue 4', fix: '', area: '' });
  assert.equal(data[oid(6)], undefined);
  assert.equal((await app.call('GET', 'omskingapi.codersalpha.com', '/summaries')).status, 404);
});

test('a finished change must be applied or discarded before the next Auto-fix starts', async (t) => {
  const { spawn, calls } = fakeSpawn();
  const app = await serve(t, { spawn });
  fs.mkdirSync(path.dirname(app.runFile), { recursive: true });
  const finished = { id: 'r1', state: 'finished', exitCode: 0, patchFile: '/tmp/r1.patch', changedFiles: ['a.txt'] };
  fs.writeFileSync(app.runFile, JSON.stringify(finished));
  const blocked = await app.call('POST');
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).message, /Apply or discard/);
  assert.equal(calls.length, 0);

  fs.writeFileSync(app.runFile, JSON.stringify({ ...finished, discarded: { reason: 'x' } }));
  assert.equal((await app.call('POST')).status, 202);
  fs.writeFileSync(app.runFile, JSON.stringify({ ...finished, id: 'r2', state: 'finished', applied: true }));
  assert.equal((await app.call('POST')).status, 202);
});

test('Apply fix completes the run\'s Awaiting apply tasks only after the patch went in cleanly', async (t) => {
  const repoDir = tempDir(t, 'autofix-repo-');
  git(repoDir, 'init', '-q');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\n');
  git(repoDir, 'add', '.');
  git(repoDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\ntwo\n');
  const patchFile = path.join(tempDir(t, 'autofix-patch-'), 'fix.patch');
  fs.writeFileSync(patchFile, `${git(repoDir, 'diff')}\n`);
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'changed meanwhile\n');

  const completed = [];
  const completeTasks = async (runId) => { completed.push(runId); return [oid(6)]; };
  const app = await serve(t, { repoDir, spawn: fakeSpawn().spawn, completeTasks });
  fs.mkdirSync(path.dirname(app.runFile), { recursive: true });
  fs.writeFileSync(app.runFile, JSON.stringify({ id: 'r1', state: 'finished', exitCode: 0, patchFile, changedFiles: ['a.txt'] }));

  const conflict = await app.call('POST', null, '/apply');
  assert.equal(conflict.status, 409);
  assert.deepEqual(completed, [], 'a patch that does not apply leaves its tasks Awaiting apply');
  assert.equal(app.readRun().applied, undefined);

  git(repoDir, 'checkout', '--', 'a.txt');
  const res = await app.call('POST', null, '/apply');
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.applied, true);
  assert.deepEqual(data.completed, [oid(6)]);
  assert.deepEqual(completed, ['r1']);
});

test('Discard needs a reason, moves the run\'s tasks to Fix failed and frees the button', async (t) => {
  const discarded = [];
  const discardTasks = (runId, reason) => { discarded.push([runId, reason]); return [oid(6)]; };
  const app = await serve(t, { spawn: fakeSpawn().spawn, discardTasks });
  fs.mkdirSync(path.dirname(app.runFile), { recursive: true });
  fs.writeFileSync(app.runFile, JSON.stringify({ id: 'r1', state: 'finished', exitCode: 0, patchFile: '/tmp/r1.patch', changedFiles: ['a.txt'] }));

  assert.equal((await app.call('POST', null, '/discard', { reason: ' ' })).status, 400);
  const res = await app.call('POST', null, '/discard', { reason: 'Conflicts with the applied tabs change' });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.discarded.reason, 'Conflicts with the applied tabs change');
  assert.deepEqual(discarded, [['r1', 'Conflicts with the applied tabs change']]);
  assert.equal((await app.call('POST', null, '/apply')).status, 409, 'a discarded change cannot be applied');
  assert.equal((await app.call('POST', null, '/discard', { reason: 'again' })).status, 409);
});

test('the button settles applied-but-unfinished tasks on every check and before a new run starts', async (t) => {
  const order = [];
  const { spawn, calls } = fakeSpawn();
  const spawnLogged = (...a) => { order.push('spawn'); return spawn(...a); };
  const reconcileTasks = async () => { order.push('reconcile'); return [oid(6)]; };
  const app = await serve(t, { spawn: spawnLogged, reconcileTasks });
  await app.call('GET');
  assert.deepEqual(order, ['reconcile']);
  assert.equal((await app.call('POST')).status, 202);
  assert.deepEqual(order, ['reconcile', 'reconcile', 'spawn'], 'stuck tasks are settled before the next run');
  assert.equal(calls.length, 1);
});

test('tasks needing input are listed for the form; the answer goes to the task (developer) or to the client as a question', async (t) => {
  const asked = [];
  const askTasks = async (messageId, question) => { asked.push([messageId, question]); };
  const needs = TASKS.replace(
    `[Not started] 3 Nov 2026, 6:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 6\n`,
    `[Needs input] 3 Nov 2026, 6:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 6\n- Unclear: Which courier?\n- Options: Delhivery | Shree Maruti\n- Input from: client\n`,
  );
  const outDir = tempDir(t, 'autofix-');
  fs.writeFileSync(path.join(outDir, 'TASKS.md'), needs);
  const app = await serve(t, { outDir, spawn: fakeSpawn().spawn, askTasks, reconcileTasks: async () => [] });

  const { data } = await (await app.call('GET', null, '/inputs')).json();
  assert.equal(data.length, 1);
  assert.equal(data[0].messageId, oid(6));
  assert.deepEqual(data[0].options, ['Delhivery', 'Shree Maruti']);
  assert.equal(data[0].nearby.before[1].messageId, oid(5));

  assert.equal((await app.call('POST', null, `/inputs/${oid(6)}`, { text: ' ', to: 'developer' })).status, 400);
  assert.equal((await app.call('POST', null, `/inputs/${oid(7)}`, { text: 'x', to: 'developer' })).status, 404);
  assert.equal((await app.call('POST', null, `/inputs/${oid(6)}`, { text: 'Which courier: Delhivery or Shree Maruti?', to: 'client' })).status, 200);
  assert.deepEqual(asked, [[oid(6), 'Which courier: Delhivery or Shree Maruti?']]);

  const dev = await app.call('POST', null, `/inputs/${oid(6)}`, { text: 'Use Delhivery', to: 'developer' });
  assert.equal(dev.status, 200);
  assert.match(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'), /\[Input given\] 3 Nov 2026, 6:00 pm/);
});

test('POST takes a chat filter or one message: bad scopes are refused, nothing to fix or input needed is said, not run', async (t) => {
  const outDir = tempDir(t, 'autofix-');
  fs.writeFileSync(path.join(outDir, 'TASKS.md'), `${entry('Not started', 1)}\n${entry('In progress', 2)}\n${entry('Needs input', 3).replace('- Notes:\n', '- Notes:\n- Unclear: Which courier?\n')}\n${entry('Complete', 4)}`);
  const spawner = fakeSpawn();
  const app = await serve(t, { outDir, spawn: spawner.spawn, reconcileTasks: async () => [] });
  assert.equal((await app.call('POST', null, '/', { scope: 'everything' })).status, 400);
  assert.equal((await app.call('POST', null, '/', { messageId: 'nope' })).status, 400);
  const fixed = await app.call('POST', null, '/', { scope: 'fixed' });
  assert.equal(fixed.status, 409);
  assert.match((await fixed.json()).message, /Nothing to auto-fix/);
  const blocked = await app.call('POST', null, '/', { messageId: oid(3) });
  assert.equal(blocked.status, 409);
  const body = await blocked.json();
  assert.equal(body.needsInput, true);
  assert.match(body.message, /Which courier\?/);
  assert.equal(spawner.calls.length, 0, 'nothing started');

  const started = await app.call('POST', null, '/', { scope: 'progress' });
  assert.equal(started.status, 202);
  assert.equal((await started.json()).data.next.messageId, oid(2), 'the chat can scroll to the message being fixed');
  const run = JSON.parse(fs.readFileSync(app.runFile, 'utf8'));
  assert.deepEqual([run.scope, run.target], ['progress', '']);
});

test('GET counts the tasks by status from the task list, so the play modal shows pending going down at once', async (t) => {
  const app = await serve(t, { spawn: fakeSpawn().spawn });
  const { progress } = (await (await app.call('GET')).json()).data;
  assert.deepEqual(progress, { pending: 4, progress: 1, complete: 2, total: 7 });
});

test('while the fix is being verified it counts as running, and the verdict is shown with the run', async (t) => {
  const { spawn, calls } = fakeSpawn();
  const app = await serve(t, { spawn });
  await app.call('POST');
  const verification = {
    pass: false, attempt: 2, reason: 'filter still at the right edge', checks: [{ name: 'admin tests', ok: true, tail: 'long output' }],
    review: { pass: false, reason: 'filter still at the right edge', requirements: [{ point: 'opens under the icon', met: false, evidence: 'OrdersPage.jsx:117' }] },
  };
  fs.writeFileSync(app.runFile, JSON.stringify({ ...app.readRun(), state: 'verifying', verification, step: 'Running the tests and build: admin build', stepAt: '2026-11-04T19:00:00.000Z' }));
  let { run } = (await (await app.call('GET')).json()).data;
  assert.equal(run.running, true);
  assert.equal(run.state, 'verifying');
  assert.equal(run.step, 'Running the tests and build: admin build');
  assert.equal(run.stepAt, '2026-11-04T19:00:00.000Z');
  assert.equal((await app.call('POST')).status, 409);
  assert.equal(calls.length, 1);
  fs.writeFileSync(app.runFile, JSON.stringify({ ...app.readRun(), state: 'finished', finishedAt: new Date().toISOString() }));
  ({ run } = (await (await app.call('GET')).json()).data);
  assert.deepEqual(run.verification, {
    pass: false, attempt: 2, reason: 'filter still at the right edge', checks: [{ name: 'admin tests', ok: true }],
    requirements: [{ point: 'opens under the icon', met: false, evidence: 'OrdersPage.jsx:117' }],
  });
});

test('Apply fix refuses a change whose done tasks were never verified, so nothing becomes Complete unchecked', async (t) => {
  const repoDir = tempDir(t, 'autofix-repo-');
  git(repoDir, 'init', '-q');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\n');
  git(repoDir, 'add', '.');
  git(repoDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\ntwo\n');
  const patchFile = path.join(tempDir(t, 'autofix-patch-'), 'fix.patch');
  fs.writeFileSync(patchFile, `${git(repoDir, 'diff')}\n`);
  git(repoDir, 'checkout', '--', 'a.txt');

  const completed = [];
  const app = await serve(t, { repoDir, spawn: fakeSpawn().spawn, completeTasks: async (id) => { completed.push(id); return []; } });
  const awaiting = TASKS.replace(
    '### [Not started] 3 Nov 2026, 6:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 6\n',
    '### [Awaiting apply] 3 Nov 2026, 6:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 6\n- Pending patch: Auto-fix run r1 — apply it with the header Apply fix button\n',
  );
  assert.notEqual(awaiting, TASKS);
  fs.writeFileSync(path.join(app.outDir, 'TASKS.md'), awaiting);
  fs.mkdirSync(path.dirname(app.runFile), { recursive: true });
  const run = { id: 'r1', messageId: oid(6), message: 'issue 6', state: 'finished', exitCode: 1, error: 'agent crashed', patchFile };
  fs.writeFileSync(app.runFile, JSON.stringify(run));

  const res = await app.call('POST', null, '/apply');
  assert.equal(res.status, 409);
  assert.match((await res.json()).message, /not verified/i);
  assert.deepEqual(completed, []);
  assert.equal(fs.readFileSync(path.join(repoDir, 'a.txt'), 'utf8'), 'one\n');

  fs.writeFileSync(app.runFile, JSON.stringify({ ...run, exitCode: 0, error: '', verification: { pass: true, attempt: 1 } }));
  assert.equal((await app.call('POST', null, '/apply')).status, 200, 'a verified change applies');
  assert.deepEqual(completed, ['r1']);
});

test('Verify fix starts the runner on a saved change that has no verdict yet, and only then', async (t) => {
  const { spawn, calls } = fakeSpawn();
  const app = await serve(t, { spawn });
  assert.equal((await app.call('POST', null, '/verify')).status, 409, 'nothing to verify yet');
  fs.mkdirSync(path.dirname(app.runFile), { recursive: true });
  const run = { id: 'r1', messageId: oid(6), message: 'issue 6', state: 'finished', exitCode: 0, patchFile: '/tmp/r1.patch', logFile: '/tmp/r1.log' };
  fs.writeFileSync(app.runFile, JSON.stringify({ ...run, verification: { pass: true } }));
  assert.equal((await app.call('POST', null, '/verify')).status, 409, 'already verified');
  fs.writeFileSync(app.runFile, JSON.stringify(run));
  const res = await app.call('POST', null, '/verify');
  assert.equal(res.status, 202);
  const { data } = await res.json();
  assert.equal(data.state, 'verifying');
  assert.equal(data.running, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(1), [app.runFile, '--launch', '--verify']);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].child.unrefed, true);
  assert.equal((await app.call('POST', null, '/apply')).status, 409, 'no apply while it is being verified');
});

test('GET /queue lists the pending messages in the order play fixes them, so the start modal can show the first N', async (t) => {
  const app = await serve(t, { spawn: fakeSpawn().spawn });
  const res = await app.call('GET', null, '/queue?limit=3');
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.deepEqual(data.map((r) => [r.messageId, r.message]), [[oid(6), 'issue 6'], [oid(7), 'issue 7'], [oid(1), 'issue 1']]);
  assert.equal(data[0].time, '3 Nov 2026, 6:00 pm');
  const all = (await (await app.call('GET', null, '/queue')).json()).data;
  assert.deepEqual(all.map((r) => r.messageId), [oid(6), oid(7), oid(1), oid(3)], 'after the last one it goes on from the top');
});

test('every open task gets a stage and an English reason for the chat; an explicit Reason line wins, Complete has none', async (t) => {
  const { taskReasons } = require('../scripts/reportInbox');
  const add = (n, label, lines = '') => entry(label, n).replace(`- Message id: ${oid(n)}\n`, `${lines}- Message id: ${oid(n)}\n`);
  const text = [
    add(1, 'Not started'),
    add(2, 'Waiting for client', '- Waiting for: Easy Ship or Self Ship for Amazon orders\n'),
    add(3, 'Needs input', '- Unclear: Which courier should book Amazon orders\n- Input from: developer\n'),
    add(4, 'Blocked', '- Status: Blocked — 5 Nov 2026: needs the live Myntra job errors\n'),
    add(5, 'In progress', '- Status: 5 Nov 2026, 8:16 am — Auto-fix left it In progress. Not verified yet: the delivery date column is missing.. The change is saved in /tmp/x.patch\n'),
    add(6, 'Complete'),
    add(7, 'Not started', `- Part of: ${oid(2)}\n`),
    add(8, 'Needs input', '- Unclear: kya poora layout chahiye\n- Reason: Needs a decision from the developer: is the full OMSGuru layout needed?\n'),
    add(9, 'Fix failed', '- Status: 5 Nov 2026, 12:41 am — Auto-fix change discarded, not applied: Not verified: backend tests failed\n'),
  ].join('\n');
  const r = taskReasons(text);
  assert.deepEqual(r[oid(1)], { stage: 'not_started', reason: 'Not started yet. It is in the queue and will be worked on in order.' });
  assert.deepEqual(r[oid(2)], { stage: 'waiting_client', reason: 'Waiting for the client: Easy Ship or Self Ship for Amazon orders' });
  assert.deepEqual(r[oid(3)], { stage: 'needs_input', reason: 'Needs a decision from the developer: Which courier should book Amazon orders' });
  assert.deepEqual(r[oid(4)], { stage: 'blocked', reason: 'Blocked: needs the live Myntra job errors' });
  assert.deepEqual(r[oid(5)], { stage: 'working', reason: 'The fix is made but not verified yet: the delivery date column is missing.' });
  assert.equal(r[oid(6)], undefined);
  assert.deepEqual(r[oid(7)], { stage: 'waiting_client', reason: 'Handled together with "issue 2". Waiting for the client: Easy Ship or Self Ship for Amazon orders' });
  assert.deepEqual(r[oid(8)], { stage: 'needs_input', reason: 'Needs a decision from the developer: is the full OMSGuru layout needed?' });
  assert.deepEqual(r[oid(9)], { stage: 'fix_failed', reason: 'The last fix attempt failed (Not verified: backend tests failed); it will be tried again.' });

  const app = await serve(t, { spawn: fakeSpawn().spawn });
  fs.writeFileSync(path.join(app.outDir, 'TASKS.md'), text);
  const res = await app.call('GET', null, '/reasons');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data[oid(2)].stage, 'waiting_client');
});
