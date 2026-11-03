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
  assert.equal(nextTask(`${entry('Not started', 1)}\n${entry('Complete', 2)}`), null);
  assert.equal(nextTask(''), null);
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
  assert.equal(saved.outDir, outDir);
  assert.equal(saved.runnerPid, process.pid);
  assert.ok(saved.worktree.startsWith('/worktrees/'), 'the agent works outside the main checkout');
  assert.ok(!JSON.stringify(saved).includes('cursor-key'));
});

test('GET previews what the next click works on, waiting tasks first, and lists every task the run touched', async (t) => {
  const { spawn } = fakeSpawn();
  const app = await serve(t, { spawn });
  let { next } = (await (await app.call('GET')).json()).data;
  assert.deepEqual(next, { kind: 'next', messageId: oid(6), message: 'issue 6', waiting: 0 });

  const waiting = TASKS.replace(
    `[Not started] 3 Nov 2026, 3:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 3\n`,
    `[Client replied] 3 Nov 2026, 3:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 3\n- Waiting for: logo\n`,
  );
  fs.writeFileSync(path.join(app.outDir, 'TASKS.md'), waiting);
  ({ next } = (await (await app.call('GET')).json()).data);
  assert.deepEqual(next, { kind: 'replied', messageId: oid(3), message: 'issue 3', waiting: 0 });

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
  assert.equal(data.next.messageId, oid(7));
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
