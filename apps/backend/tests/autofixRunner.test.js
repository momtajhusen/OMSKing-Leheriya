process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runAutofix, launch, verifyAutofix, checkCommands } = require('../scripts/autofixRunner');

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
  assert.match(run.prompt, /--check "<kaise check karein/, 'the agent also leaves steps to verify the fix');
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

test('a task left In progress by an interrupted run is finished first', async (t) => {
  const { runFile, readRun } = setup(t, 'process.exit(0);', [entry('Complete', 1), entry('In progress', 2), entry('Not started', 3)]);
  await runAutofix(runFile, { ...noInbox, completeTasks: async () => {} });
  const run = readRun();
  assert.equal(run.plan.kind, 'resume');
  assert.equal(run.messageId, oid(2));
  assert.match(run.prompt, /was left In progress by an Auto-fix run that stopped before finishing/);
  assert.match(run.prompt, new RegExp(`--mark complete ${oid(2)}`));
});

test('the prompt fixes a clear task directly, reads the nearby messages only when needed, and asks for input only when still unclear', async (t) => {
  const { runFile, readRun } = setup(t, 'process.exit(0);', [entry('Complete', 1), entry('Not started', 2), entry('Not started', 3)]);
  await runAutofix(runFile, { ...noInbox, completeTasks: async () => {} });
  const { prompt } = readRun();
  assert.match(prompt, /If the task message alone is enough to understand and fix it, fix it directly and ask nothing\./);
  assert.match(prompt, /Only if it is not enough, read the nearby messages:\n {6}- before: \d+ \("issue 1", Complete\)\n {6}- after: \d+ \("issue 3", Not started\)/);
  assert.match(prompt, new RegExp(`npm run report-inbox -- --unclear ${oid(2)} --need "<what is unclear>" --need-hi "[^"]+" --options "<option 1> \\| <option 2>" --from <developer\\|client>`));
  assert.match(prompt, /Never guess and never leave the task In progress/);
  assert.match(prompt, /--need-hi "<the same need in short Hinglish: Hindi words in English letters>"/);
  assert.match(
    prompt,
    new RegExp(`If a test or check fails, or testing needs something you do not have .*--unclear ${oid(2)} --need "<what is needed>" --need-hi "<the same need in short Hinglish: Hindi words in English letters>" --options "<option 1> \\| <option 2>" --from <developer\\|client> --during testing`),
  );
});

test('a run started from a chat filter or one message plans only that scope', async (t) => {
  const { runFile, readRun } = setup(t, 'process.exit(0);', [entry('Not started', 1), entry('In progress', 2), entry('Not started', 3)]);
  fs.writeFileSync(runFile, JSON.stringify({ ...readRun(), scope: 'progress' }));
  await runAutofix(runFile, { ...noInbox, completeTasks: async () => {} });
  assert.deepEqual([readRun().plan.kind, readRun().messageId, readRun().plan.next], ['resume', oid(2), null]);
});

test('a run for one message that has nothing to fix stops with a note', async (t) => {
  const { runFile, readRun } = setup(t, 'process.exit(0);', [entry('Complete', 1), entry('Not started', 2)]);
  fs.writeFileSync(runFile, JSON.stringify({ ...readRun(), target: oid(1) }));
  await runAutofix(runFile, { ...noInbox, completeTasks: async () => {} });
  assert.equal(readRun().state, 'finished');
  assert.match(readRun().note, /Nothing to fix/);
});

test('launch hands the run to a detached grandchild and records its pid, so a nodemon restart cannot kill the fix', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autofix-launch-'));
  const runFile = path.join(dir, 'current.json');
  fs.writeFileSync(runFile, JSON.stringify({ id: 'r1', state: 'starting', runnerPid: 1 }));
  const calls = [];
  const child = { pid: 4242, unrefed: false, unref() { this.unrefed = true; } };
  launch(runFile, { spawnRunner: (bin, args, options) => { calls.push({ bin, args, options }); return child; } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, process.execPath);
  assert.match(calls[0].args[0], /scripts[/\\]autofixRunner\.js$/);
  assert.equal(calls[0].args[1], runFile);
  assert.equal(calls[0].args.length, 2, 'the grandchild runs the fix itself, it does not launch again');
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.equal(child.unrefed, true);
  const saved = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  assert.equal(saved.runnerPid, 4242);
  assert.equal(saved.state, 'starting');
});

/** Fixer on the first call (marks task 2 Awaiting apply), reviewer when the runner asks for a verdict. */
const VERIFIED_AGENT = `
const fs = require('fs');
const prompt = process.argv[process.argv.length - 1];
const state = process.env.FAKE_STATE;
const seen = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, 'utf8')) : { fixes: [], reviews: 0 };
const verdictFile = process.env.REPORT_AUTOFIX_VERDICT;
if (verdictFile) {
  seen.reviews += 1;
  seen.reviewPrompt = prompt;
  const mode = process.env.FAKE_REVIEW;
  if (mode === 'slow') { fs.writeFileSync(state, JSON.stringify(seen)); setTimeout(() => {}, 60000); return; }
  const pass = mode === 'pass';
  if (mode !== 'none') {
    fs.writeFileSync(verdictFile, JSON.stringify({
      pass, reason: pass ? 'all points met' : 'the Status filter still opens at the right edge',
      requirements: [{ point: 'filter opens under its icon', met: pass, evidence: 'OrdersPage.jsx:117' }],
    }));
  }
} else {
  seen.fixes.push(prompt);
  fs.appendFileSync('a.txt', seen.fixes.length === 1 ? 'fixed\\n' : 'fixed more\\n');
  const tasks = 'client-reports/TASKS.md';
  fs.writeFileSync(tasks, fs.readFileSync(tasks, 'utf8').replace(
    /### \\[Not started\\] (3 Nov 2026, 2:00 pm[^\\n]*)\\n- Message: issue 2\\n/,
    '### [Awaiting apply] $1\\n- Message: issue 2\\n- Pending patch: Auto-fix run run-1 — apply it with the header Apply fix button\\n',
  ));
}
fs.writeFileSync(state, JSON.stringify(seen));
`;

function verifiedSetup(t, review) {
  const ctx = setup(t, VERIFIED_AGENT);
  const state = path.join(ctx.outDir, 'fake-state.json');
  const saved = { FAKE_STATE: process.env.FAKE_STATE, FAKE_REVIEW: process.env.FAKE_REVIEW };
  process.env.FAKE_STATE = state;
  process.env.FAKE_REVIEW = review;
  t.after(() => Object.entries(saved).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));
  return { ...ctx, seen: () => JSON.parse(fs.readFileSync(state, 'utf8')) };
}

const passingChecks = (calls = []) => async (worktree, files) => { calls.push(files); return [{ name: 'admin tests', ok: true, tail: '' }]; };

test('a fix is kept for Apply only after the checks and an independent reviewer pass every client point', async (t) => {
  const { runFile, readRun, seen } = verifiedSetup(t, 'pass');
  const checked = [];
  const completed = [];
  await runAutofix(runFile, { ...noInbox, runChecks: passingChecks(checked), completeTasks: async (id) => { completed.push(id); } });
  const run = readRun();
  assert.equal(run.state, 'finished');
  assert.equal(run.verification.pass, true);
  assert.equal(run.verification.attempt, 1);
  assert.deepEqual(run.verification.review.requirements, [{ point: 'filter opens under its icon', met: true, evidence: 'OrdersPage.jsx:117' }]);
  assert.ok(run.patchFile);
  assert.deepEqual(checked, [['a.txt']], 'the runner runs the checks itself on the changed files');
  assert.deepEqual(completed, [], 'Complete still waits for Apply fix');
  const { reviews, reviewPrompt, fixes } = seen();
  assert.equal(reviews, 1);
  assert.equal(fixes.length, 1);
  assert.match(reviewPrompt, /issue 2/);
  assert.match(reviewPrompt, /point by point/);
  assert.match(reviewPrompt, /Do not change, create or delete any file/);
  assert.match(reviewPrompt, /Client reply/);
});

test('a fix the reviewer rejects is left In progress with the reason and its change saved, and play goes on (no retry)', async (t) => {
  const { runFile, outDir, readRun, seen } = verifiedSetup(t, 'fail');
  const completed = [];
  await runAutofix(runFile, { ...noInbox, runChecks: passingChecks(), completeTasks: async (id) => { completed.push(id); } });
  const run = readRun();
  assert.equal(run.verification.pass, false);
  assert.equal(run.patchFile, null, 'an unverified change is never offered for Apply');
  assert.ok(fs.readFileSync(run.heldPatch, 'utf8').includes('+fixed'), 'the change is kept aside for a look');
  assert.equal(run.error, '', 'the play loop goes on with the next message');
  assert.match(run.note, /Left In progress/);
  assert.deepEqual(completed, []);
  assert.equal(seen().fixes.length, 1, 'no second fixer run');
  assert.equal(seen().reviews, 1);
  const tasks = fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8');
  assert.match(tasks, /### \[In progress\] 3 Nov 2026, 2:00 pm/);
  assert.doesNotMatch(tasks, /Pending patch: Auto-fix run run-1/);
  assert.match(tasks, /Not verified yet: the Status filter still opens at the right edge/);
  assert.ok(tasks.includes(run.heldPatch));
});

test('each step is written to the run while it happens, so the play modal can say what is going on', async (t) => {
  const { runFile, readRun } = verifiedSetup(t, 'pass');
  const steps = [];
  const runChecks = async () => { steps.push(readRun().step); return [{ name: 'admin tests', ok: true, tail: '' }]; };
  await runAutofix(runFile, { ...noInbox, runChecks, completeTasks: async () => {} });
  assert.match(steps[0], /Running the tests and build/);
  assert.ok(readRun().stepAt);
  assert.equal(readRun().step, 'Done');
});

test('failing tests or build stop the fix before the review and leave it In progress', async (t) => {
  const { runFile, outDir, readRun, seen } = verifiedSetup(t, 'pass');
  const runChecks = async () => [{ name: 'admin build', ok: false, tail: 'vite: error' }];
  await runAutofix(runFile, { ...noInbox, runChecks, completeTasks: async () => {} });
  const run = readRun();
  assert.equal(seen().reviews, 0, 'no review of a change whose build failed');
  assert.equal(run.verification.pass, false);
  assert.match(run.verification.reason, /admin build failed/);
  assert.equal(run.patchFile, null);
  assert.match(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'), /### \[In progress\] 3 Nov 2026, 2:00 pm/);
});

test('a missing verdict never counts as a pass', async (t) => {
  const { runFile, readRun } = verifiedSetup(t, 'none');
  await runAutofix(runFile, { ...noInbox, runChecks: passingChecks(), completeTasks: async () => {} });
  assert.match(readRun().verification.reason, /no verdict/);
  assert.equal(readRun().patchFile, null);
});

test('a reviewer that takes too long is stopped and the task is left In progress', async (t) => {
  const { runFile, readRun } = verifiedSetup(t, 'slow');
  const started = Date.now();
  await runAutofix(runFile, { ...noInbox, runChecks: passingChecks(), completeTasks: async () => {}, reviewTimeoutMs: 300 });
  assert.ok(Date.now() - started < 8000, 'the runner did not wait for the slow reviewer');
  assert.match(readRun().verification.reason, /took too long/);
});

test('the runner tests only what the fix touched: its own test files and, for admin, the build', () => {
  assert.deepEqual(checkCommands(['apps/backend/src/a.js', 'apps/backend/tests/a.test.js', 'apps/backend/tests/b.test.js'], '/tmp/b'), [
    { name: 'backend tests', cmd: 'node --test tests/a.test.js tests/b.test.js', dir: 'apps/backend' },
  ]);
  assert.deepEqual(checkCommands(['apps/admin/src/pages/admin/X.jsx', 'apps/admin/src/lib/x.test.js'], '/tmp/b'), [
    { name: 'admin tests', cmd: 'node --test src/lib/x.test.js', dir: 'apps/admin' },
    { name: 'admin build', cmd: 'npx vite build --outDir /tmp/b --emptyOutDir', dir: 'apps/admin' },
  ]);
  assert.deepEqual(checkCommands(['apps/admin/src/pages/admin/X.jsx'], '/tmp/b').map((c) => c.name), ['admin build']);
  assert.deepEqual(checkCommands(['docs/a.md', 'apps/backend/src/a.js'], '/tmp/b'), [], 'no test file changed: nothing to run, the reviewer judges it');
});

/** A finished run from before verification existed: a saved patch, its task Awaiting apply, no verdict. */
function unverifiedRun(t, review, { done = true } = {}) {
  const ctx = verifiedSetup(t, review);
  const base = git(ctx.repoDir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(ctx.repoDir, 'a.txt'), 'committed\nfixed\n');
  const patchFile = path.join(ctx.outDir, 'autofix', 'run-1.patch');
  fs.writeFileSync(patchFile, `${git(ctx.repoDir, 'diff')}\n`);
  fs.writeFileSync(path.join(ctx.repoDir, 'a.txt'), 'committed\nuncommitted\n');
  const task2 = done
    ? '### [Awaiting apply] 3 Nov 2026, 2:00 pm · PRDOSCO · Leheriya Super Admin\n- Message: issue 2\n- Pending patch: Auto-fix run run-1 — apply it with the header Apply fix button\n- Message id: ' + oid(2) + '\n'
    : entry('In progress', 2);
  fs.writeFileSync(path.join(ctx.outDir, 'TASKS.md'), `# tasks\n\n${[entry('Complete', 1), task2].join('\n')}`);
  fs.writeFileSync(ctx.runFile, JSON.stringify({
    ...ctx.readRun(), state: 'finished', exitCode: 0, error: '', base, patchFile, changedFiles: ['a.txt'], applied: false, prompt: 'fix issue 2', messageId: oid(2),
  }));
  return { ...ctx, patchFile };
}

test('Verify fix checks a saved change that was never verified, in a fresh copy, and keeps it when it passes', async (t) => {
  const { runFile, repoDir, readRun, seen, before } = unverifiedRun(t, 'pass');
  const checked = [];
  await verifyAutofix(runFile, { runChecks: passingChecks(checked), completeTasks: async () => {} });
  const run = readRun();
  assert.equal(run.state, 'finished');
  assert.equal(run.verification.pass, true);
  assert.deepEqual(checked, [['a.txt']]);
  assert.match(fs.readFileSync(run.patchFile, 'utf8'), /\+fixed/);
  assert.equal(seen().reviews, 1);
  assert.deepEqual(seen().fixes, [], 'no fixer run when the review passes');
  assert.equal(git(repoDir, 'status', '--porcelain'), before, 'the main checkout is untouched');
  assert.equal(git(repoDir, 'worktree', 'list').split('\n').length, 1, 'the verify copy is removed');
});

test('Verify fix on a rejected change leaves the task In progress without a retry', async (t) => {
  const { runFile, outDir, readRun, seen } = unverifiedRun(t, 'fail');
  await verifyAutofix(runFile, { runChecks: passingChecks(), completeTasks: async () => {} });
  const run = readRun();
  assert.equal(run.verification.pass, false);
  assert.equal(run.patchFile, null);
  assert.deepEqual(seen().fixes, [], 'no fixer run');
  assert.match(fs.readFileSync(path.join(outDir, 'TASKS.md'), 'utf8'), /### \[In progress\] 3 Nov 2026, 2:00 pm/);
});

test('Verify fix with no task marked done rejects the change instead of leaving it unverified', async (t) => {
  const { runFile, readRun, seen } = unverifiedRun(t, 'pass', { done: false });
  await verifyAutofix(runFile, { runChecks: passingChecks(), completeTasks: async () => {} });
  const run = readRun();
  assert.equal(run.verification.pass, false);
  assert.match(run.verification.reason, /No task of this run is marked done/);
  assert.equal(run.patchFile, null);
  assert.throws(() => seen(), /ENOENT/, 'no reviewer or fixer was started');
});

test('the fixer and the reviewer run only the touched test files with compact output, never the whole backend suite', async (t) => {
  const { runFile, readRun, seen } = verifiedSetup(t, 'pass');
  await runAutofix(runFile, { ...noInbox, runChecks: passingChecks(), completeTasks: async () => {} });
  const { prompt } = readRun();
  assert.match(prompt, /--test-reporter=dot/);
  assert.doesNotMatch(prompt, /npm test/, 'a full backend run puts ~28k tokens of test output into the agent');
  assert.match(prompt, /Do not run the whole backend suite/);
  assert.match(seen().reviewPrompt, /--test-reporter=dot/);
});

test('the fixer and the reviewer use the message media: screenshots, video frames, and ask for what a voice note says', async (t) => {
  const { runFile, readRun, seen } = verifiedSetup(t, 'pass');
  await runAutofix(runFile, { ...noInbox, runChecks: passingChecks(), completeTasks: async () => {} });
  for (const prompt of [readRun().prompt, seen().reviewPrompt]) {
    assert.match(prompt, /Video frames/);
    assert.match(prompt, /voice note/i);
  }
  assert.match(readRun().prompt, /--unclear <task id> --need "what the voice note says" --options "I will type it here \| Ask the client to write it" --from developer/);
});
