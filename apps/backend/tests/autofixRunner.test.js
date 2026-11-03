process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runAutofix } = require('../scripts/autofixRunner');

const oid = (n) => n.toString(16).padStart(24, '0');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function entry(label, n, extra = '') {
  return `### [${label}] 3 Nov 2026, ${n}:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue ${n}\n${extra}- Message id: ${oid(n)}\n`;
}

const WAITING = (n) => entry('Waiting for client', n, `- Waiting for: stock export file\n- Asked client: Please send the stock export (question id ${oid(90)}, 3 Nov 2026)\n`);

/** A repo with a commit, an uncommitted edit, a new file and an ignored client-reports folder, like the developer's checkout. */
function setup(t, agentSource, tasks = [entry('Complete', 1), entry('Not started', 2), entry('Not started', 3)]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autofix-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repoDir = path.join(root, 'repo');
  fs.mkdirSync(repoDir);
  git(repoDir, 'init', '-q');
  fs.writeFileSync(path.join(repoDir, '.gitignore'), 'client-reports/\n.env\n');
  fs.writeFileSync(path.join(repoDir, '.env'), 'SECRET=local\n');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'committed\n');
  git(repoDir, 'add', '.');
  git(repoDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'committed\nuncommitted\n');
  fs.writeFileSync(path.join(repoDir, 'b.txt'), 'new file\n');
  const outDir = path.join(repoDir, 'client-reports');
  fs.mkdirSync(path.join(outDir, 'autofix'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'TASKS.md'), `# tasks\n\n${tasks.join('\n')}`);

  const agentBin = path.join(root, 'fake-agent.js');
  fs.writeFileSync(agentBin, `#!/usr/bin/env node\n${agentSource}`);
  fs.chmodSync(agentBin, 0o755);

  const runFile = path.join(outDir, 'autofix', 'current.json');
  const worktree = path.join(root, 'worktrees', 'run-1');
  fs.writeFileSync(runFile, JSON.stringify({
    id: 'run-1', state: 'starting', repoDir, outDir, worktree, agentBin, model: '', logFile: path.join(outDir, 'autofix', 'run-1.log'),
  }));
  const before = git(repoDir, 'status', '--porcelain');
  return { repoDir, outDir, runFile, worktree, before, readRun: () => JSON.parse(fs.readFileSync(runFile, 'utf8')) };
}

const noInbox = { checkInbox: async () => {} };

const WORKING_AGENT = `
const fs = require('fs');
if (!process.cwd().includes('worktrees')) process.exit(3);
if (!fs.readFileSync('a.txt', 'utf8').includes('uncommitted') || !fs.existsSync('b.txt')) process.exit(4);
if (!fs.existsSync('client-reports/TASKS.md')) process.exit(5);
fs.appendFileSync('a.txt', 'fixed\\n');
fs.writeFileSync('fix.txt', 'new test\\n');
fs.appendFileSync('client-reports/TASKS.md', 'marked\\n');
console.log('agent done');
`;

test('the agent works in a worktree of the current files and its change comes back as a patch', async (t) => {
  const { repoDir, outDir, runFile, worktree, before, readRun } = setup(t, WORKING_AGENT);
  await runAutofix(runFile, noInbox);

  const run = readRun();
  assert.equal(run.state, 'finished');
  assert.equal(run.exitCode, 0, fs.readFileSync(run.logFile, 'utf8'));
  assert.equal(run.error, '');
  assert.deepEqual(run.changedFiles.sort(), ['a.txt', 'fix.txt']);
  const patch = fs.readFileSync(run.patchFile, 'utf8');
  assert.match(patch, /\+fixed/);
  assert.match(patch, /fix\.txt/);
  assert.doesNotMatch(patch, /^\+uncommitted/m, 'the developer\'s own edits are the base, not part of the fix');
  assert.doesNotMatch(patch, /b\.txt/);
  assert.doesNotMatch(patch, /client-reports/);

  assert.equal(git(repoDir, 'status', '--porcelain'), before, 'the main checkout and its index are untouched');
  assert.equal(fs.existsSync(path.join(repoDir, 'fix.txt')), false);
  assert.match(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'), /marked\n$/, 'the shared task list is updated in place');
  assert.equal(fs.existsSync(worktree), false, 'the worktree is removed afterwards');
  assert.equal(git(repoDir, 'worktree', 'list').split('\n').length, 1);
  assert.match(fs.readFileSync(run.logFile, 'utf8'), /agent done/);
});

test('an agent that fails is recorded with its last line and leaves no patch', async (t) => {
  const { runFile, worktree, readRun } = setup(t, "console.log('Error: Authentication required.'); process.exit(1);");
  await runAutofix(runFile, noInbox);
  const run = readRun();
  assert.equal(run.state, 'finished');
  assert.equal(run.exitCode, 1);
  assert.match(run.error, /Authentication required/);
  assert.equal(run.patchFile, null);
  assert.equal(fs.existsSync(worktree), false);
});

test('a plain click fixes the next pending task; needing the client means asking, then fixing the following task', async (t) => {
  const { runFile, readRun } = setup(t, 'process.exit(0);');
  await runAutofix(runFile, noInbox);
  const run = readRun();
  assert.equal(run.plan.kind, 'next');
  assert.equal(run.messageId, oid(2));
  assert.deepEqual(run.candidates, [oid(2), oid(3)]);
  assert.match(run.prompt, new RegExp(`--mark in-progress ${oid(2)}`));
  assert.match(run.prompt, new RegExp(`--ask ${oid(2)} --need`));
  assert.match(run.prompt, new RegExp(`do not stop: fix task ${oid(3)}`));
  assert.match(run.prompt, /Never ask the client for passwords, API keys or other secrets/);
  assert.match(run.prompt, /Never deploy, commit or push/);
  assert.match(run.prompt, /separate git worktree/);
});

test('the inbox is checked first, so a client reply that just arrived is fixed before anything else', async (t) => {
  const { runFile, outDir, readRun } = setup(t, 'process.exit(0);', [entry('Complete', 1), WAITING(2), entry('Not started', 3)]);
  const checkInbox = async () => {
    const file = path.join(outDir, 'TASKS.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('[Waiting for client]', '[Client replied]'));
  };
  await runAutofix(runFile, { checkInbox });
  const run = readRun();
  assert.equal(run.plan.kind, 'replied');
  assert.equal(run.messageId, oid(2));
  assert.match(run.prompt, /collapsed "Client reply" block/);
  assert.match(run.prompt, new RegExp(`--mark complete ${oid(2)}`));
  assert.match(run.prompt, /--issue "<issue kya tha>" --fix "<fix kya kiya>"/);
  assert.match(run.prompt, /short Hinglish \(Hindi words in English letters/);
  assert.match(run.prompt, new RegExp(`fix task ${oid(3)}`));
});

test('a waiting task is checked against the reply, then the whole history, and never blocks the next pending task', async (t) => {
  const { runFile, readRun } = setup(t, 'process.exit(0);', [entry('Complete', 1), WAITING(2), entry('Not started', 3)]);
  await runAutofix(runFile, noInbox);
  const run = readRun();
  assert.equal(run.plan.kind, 'waiting');
  assert.deepEqual(run.candidates, [oid(2), oid(3)]);
  const order = ['a) Has the client answered', 'b) If not, search the entire message history', 'c) If none of them is answered or found anywhere'];
  const at = order.map((step) => run.prompt.indexOf(step));
  assert.ok(at.every((i) => i >= 0) && at[0] < at[1] && at[1] < at[2], 'checked in strict order');
  assert.match(run.prompt, new RegExp(`question id ${oid(90)}`));
  assert.match(run.prompt, /npm run report-inbox -- --history/);
  assert.match(run.prompt, /npm run report-inbox -- --attach <task id> <found message id>/);
  assert.match(run.prompt, new RegExp(`do not ask again\\) and do not stop — fix task ${oid(3)}`));
});

test('with nothing waiting or pending the run ends without starting the agent', async (t) => {
  const { runFile, worktree, readRun } = setup(t, 'process.exit(9);', [entry('Complete', 1)]);
  await runAutofix(runFile, noInbox);
  const run = readRun();
  assert.equal(run.state, 'finished');
  assert.equal(run.exitCode, 0);
  assert.match(run.note, /Nothing to fix/);
  assert.equal(fs.existsSync(worktree), false);
});

test('a failed inbox check is noted and the run goes on with the task list as it is', async (t) => {
  const { runFile, readRun } = setup(t, 'process.exit(0);');
  await runAutofix(runFile, { checkInbox: async () => { throw new Error('live API down'); } });
  const run = readRun();
  assert.equal(run.messageId, oid(2));
  assert.match(fs.readFileSync(run.logFile, 'utf8'), /Inbox check failed: live API down/);
});

test('the agent knows its run, so complete waits for Apply fix; a run with no code change completes its tasks at once', async (t) => {
  const { runFile, readRun } = setup(t, "console.log(`run=${process.env.REPORT_AUTOFIX_RUN}`);");
  const completed = [];
  await runAutofix(runFile, { ...noInbox, completeTasks: async (id) => { completed.push(id); } });
  const run = readRun();
  assert.match(fs.readFileSync(run.logFile, 'utf8'), /run=run-1/);
  assert.equal(run.patchFile, null);
  assert.deepEqual(completed, ['run-1'], 'nothing to apply, so nothing to wait for');
  assert.match(run.prompt, /Awaiting apply/);
  assert.match(run.prompt, /becomes Complete only when the developer applies the change/);
});

test('a run that changed code leaves its tasks Awaiting apply until the change is applied', async (t) => {
  const { runFile, readRun } = setup(t, WORKING_AGENT);
  const completed = [];
  await runAutofix(runFile, { ...noInbox, completeTasks: async (id) => { completed.push(id); } });
  assert.ok(readRun().patchFile);
  assert.deepEqual(completed, []);
});
