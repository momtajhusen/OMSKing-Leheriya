#!/usr/bin/env node
/**
 * Runs one header Auto-fix job outside the backend process, so a backend restart does not stop it.
 *
 *   node scripts/autofixRunner.js <client-reports/autofix/current.json>
 *
 * It first checks the live inbox (so a client reply that just arrived is attached), then plans the work in strict
 * order: a task whose client reply arrived; else the tasks waiting for the client, which the agent checks against the
 * reply and the whole message history before falling back to the next pending task; else the next pending task.
 *
 * The agent works in a git worktree made from a snapshot of the main checkout (uncommitted and new files included),
 * so it never edits the files or the git index the developer is using. Its change is saved as a .patch next to the
 * log, the worktree is removed, and every step is written back to the run file the Auto-fix button reads.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');
const { runOnce, planAutofix, nearbyTasks, runTasks } = require('./reportInbox');

const CHECK_TIMEOUT_MS = 5 * 60 * 1000;
const REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

/** Ignored files the agent needs (dependencies, .env, the shared task list), linked from the main checkout. */
const LINKS = ['node_modules', 'apps/backend/node_modules', 'apps/admin/node_modules', 'apps/backend/.env', '.env', 'client-reports'];
const GIT_ID = {
  GIT_AUTHOR_NAME: 'OMSKing Auto-fix', GIT_AUTHOR_EMAIL: 'autofix@localhost',
  GIT_COMMITTER_NAME: 'OMSKing Auto-fix', GIT_COMMITTER_EMAIL: 'autofix@localhost',
};

function readRun(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeRun(file, changes) {
  const next = { ...readRun(file), ...changes };
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return next;
}

function git(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
}

/** A commit of the checkout as it is now, built with a throwaway index so the real index is never locked or changed. */
function snapshot(repoDir) {
  const index = path.join(os.tmpdir(), `omsking-autofix-index-${process.pid}-${Date.now()}`);
  try {
    const env = { GIT_INDEX_FILE: index };
    git(repoDir, ['add', '-A'], env);
    const tree = git(repoDir, ['write-tree'], env);
    return git(repoDir, ['commit-tree', tree, '-p', 'HEAD', '-m', 'Auto-fix snapshot'], GIT_ID);
  } finally {
    fs.rmSync(index, { force: true });
  }
}

function linkIgnored(repoDir, worktree) {
  for (const rel of LINKS) {
    const from = path.join(repoDir, rel);
    const to = path.join(worktree, rel);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.symlinkSync(from, to);
  }
}

function unlinkIgnored(worktree) {
  for (const rel of LINKS) {
    const to = path.join(worktree, rel);
    try {
      if (fs.lstatSync(to).isSymbolicLink()) fs.unlinkSync(to);
    } catch { /* not linked */ }
  }
}

/** The agent's change against the snapshot, new files included. Call after unlinkIgnored so the links are not in it. */
function collectChange(worktree, base) {
  git(worktree, ['add', '-A']);
  return {
    patch: git(worktree, ['diff', '--cached', '--binary', base]),
    files: git(worktree, ['diff', '--cached', '--name-only', base]).split('\n').filter(Boolean),
  };
}

function nearbyLines(nearby) {
  if (!nearby) return '      (the 2 tasks before and the 2 after it in client-reports/TASKS.md)';
  const line = (side, m) => `      - ${side}: ${m.messageId} ("${m.message}", ${m.status})`;
  const lines = [...nearby.before.map((m) => line('before', m)), ...nearby.after.map((m) => line('after', m))];
  return lines.length ? lines.join('\n') : '      (none)';
}

function fixSteps(id, buildDir, nearby = null) {
  return [
    `   - Mark it started: npm run report-inbox -- --mark in-progress ${id} (in apps/backend).`,
    '   - If the task message alone is enough to understand and fix it, fix it directly and ask nothing.',
    `   - Only if it is not enough, read the nearby messages:\n${nearbyLines(nearby)}`,
    '     The requirement may be split over them or said slightly earlier; use what they add.',
    `   - Still not enough after them: npm run report-inbox -- --unclear ${id} --need "<what is unclear>" --options "<option 1> | <option 2>" --from <developer|client>`
    + ' (2-3 concrete options; developer = a decision about the code or product, client = information only the client has). That shows a form to the developer with this context. Then go on with the next step below. Never guess and never leave the task In progress.',
    '   - Read the task, its notes and its collapsed blocks in client-reports/TASKS.md, and look at every media file it links in client-reports/media: open each screenshot, and for a video open its "Video frames" folder (still frames of the video). Then read the relevant code. Write a failing automated test first, then the smallest fix.',
    '   - A voice note cannot be listened to. If the task depends on what a voice note says, do not guess: run npm run report-inbox -- --unclear <task id> --need "what the voice note says" --options "I will type it here | Ask the client to write it" --from developer, then go on with the next step below.',
    '   - Re-run only the test files you added or changed and the ones for the code you changed, with compact output: node --test --test-reporter=dot <files>'
    + ' (backend files in apps/backend/tests, admin files in apps/admin/src). Do not run the whole backend suite: its output is huge and the runner checks your test files after you.'
    + ` For admin changes also: npx vite build --outDir ${buildDir} --emptyOutDir 2>&1 | tail -5.`,
    `   - Only when they all pass: npm run report-inbox -- --mark complete ${id} <ids of tasks marked "Part of: ${id}"> --issue "<issue kya tha>" --fix "<fix kya kiya>" --check "<kaise check karein: page kholo; kya dabao; kya dikhna chahiye>"`
    + ' (each a single line in short Hinglish (Hindi words in English letters, not Devanagari, not pure English), e.g. --issue "Inventory page load nahi ho raha tha" --fix "Inventory API halki ki, ab page jaldi khulta hai"; it shows on the message\'s detail icon),',
    `     and add "- Status: Fixed and verified <date> — <what was checked>; made by Auto-fix, apply it with the header Apply fix button; local only, not deployed" to that task.`,
    '     In this Auto-fix copy that sets the task to Awaiting apply: it becomes Complete only when the developer applies the change. Do not mark it again.',
    `   - Still failing after one retry with a different approach: undo your changes for it, run --mark failed ${id} and add a "- Status:" line with the reason.`,
  ].join('\n');
}

function askOrNext(id, next) {
  return [
    `   - If the fix needs something only the client can give (information, a file, a screenshot, a decision), do not guess: run npm run report-inbox -- --ask ${id} --need "<what is needed>" --question "<one short, polite question in simple English>". It marks the task Waiting for client and asks the client as a reply to their message.`,
    `   - Never ask the client for passwords, API keys or other secrets: mark that task blocked instead (--mark blocked ${id}, with a "- Status: Blocked — <what is needed>" line). Anything else you cannot get, like a live action, is blocked too.`,
    next ? `   - After asking or blocking, do not stop: fix task ${next.messageId} ("${next.message}") instead, with the same steps; if that one also needs the client, ask and stop.` : '   - After asking or blocking, stop: there is no other pending task.',
  ].join('\n');
}

/** The agent's instructions for one click, following the plan's strict order. */
function fixPrompt(plan, buildDir, text = '') {
  const near = (id) => (text ? nearbyTasks(text, id) : null);
  const lines = [
    'You are in a separate git worktree copy of the project: the developer keeps working in the main folder at the same time, so only change files inside this copy. The dev servers do not run from this copy, so skip browser checks; the developer applies your change afterwards.',
    'Follow .cursor/rules/report-fix-loop.mdc and .cursor/rules/omsking-qa.mdc. Fix at most one task in this run (plus one fallback task only where it says so).',
    '',
  ];
  if (plan.kind === 'next') {
    lines.push(`Fix the client Report task ${plan.task.messageId} ("${plan.task.message}") in client-reports/TASKS.md:`, fixSteps(plan.task.messageId, buildDir, near(plan.task.messageId)), askOrNext(plan.task.messageId, plan.next));
  } else if (plan.kind === 'resume') {
    lines.push(
      `Task ${plan.task.messageId} ("${plan.task.message}") was left In progress by an Auto-fix run that stopped before finishing. Check what is already done in this copy and in client-reports/TASKS.md, then finish it:`,
      fixSteps(plan.task.messageId, buildDir, near(plan.task.messageId)),
      askOrNext(plan.task.messageId, plan.next),
    );
  } else if (plan.kind === 'replied') {
    const { task } = plan;
    lines.push(
      task.input
        ? `Task ${task.messageId} ("${task.message}") was unclear${task.unclear ? ` (${task.unclear})` : ''}. The developer's answer is attached under it in client-reports/TASKS.md as a collapsed "Developer input" block. Fix it now following that answer:`
        : `Task ${task.messageId} ("${task.message}") was waiting for the client${task.need ? ` (needed: ${task.need})` : ''}. The client's answer is attached under it in client-reports/TASKS.md as a collapsed "Client reply" block, so the requirement is fulfilled. Fix it now:`,
      fixSteps(task.messageId, buildDir, near(task.messageId)),
      askOrNext(task.messageId, plan.next),
    );
  } else {
    lines.push(
      'These tasks are waiting for the client (oldest first):',
      ...plan.waiting.map((w) => `   - ${w.messageId} ("${w.message}"): needs ${w.need || 'see the task notes'}${w.questionId ? `; asked as question id ${w.questionId}` : ''}`),
      'Check them in this strict order, oldest first, and fix at most one of them:',
      'a) Has the client answered? Look for a client message that replies to the question id, or any later client message that gives what is needed.',
      'b) If not, search the entire message history for that requirement: run npm run report-inbox -- --history in apps/backend (every message of every chat, both sides, with reply ids) and read client-reports/TASKS.md.',
      'If it is found in a) or b): run npm run report-inbox -- --attach <task id> <found message id> in apps/backend. That adds the found message, collapsed with its details, under the task and links the found message\'s own task as part of it. Then fix that task:',
      fixSteps('<task id>', buildDir),
      `c) If none of them is answered or found anywhere: leave them Waiting for client (do not ask again) and do not stop — ${plan.next ? `fix task ${plan.next.messageId} ("${plan.next.message}") instead:` : 'there is no pending task, so stop.'}`,
    );
    if (plan.next) lines.push(fixSteps(plan.next.messageId, buildDir, near(plan.next.messageId)), askOrNext(plan.next.messageId, null));
  }
  lines.push(
    '',
    'Never deploy, commit or push. Never message the client except with the --ask command above. Never touch live integrations (Delhivery, Shopify, Amazon, Myntra). Do not start or stop any server. Do not work on any other task.',
    'End with what you changed, the test results and the final status of each task you touched.',
  );
  return lines.join('\n');
}

function primary(plan) {
  if (plan.kind === 'waiting') return plan.waiting[0];
  return plan.task;
}

function candidates(plan) {
  const ids = plan.kind === 'waiting' ? plan.waiting.map((w) => w.messageId) : [plan.task.messageId];
  if (plan.next && !ids.includes(plan.next.messageId)) ids.push(plan.next.messageId);
  return ids;
}

async function defaultCheckInbox(outDir) {
  const settings = require('../src/config').supportLive;
  await runOnce({ settings, outDir, logger: { log: () => {} } });
}

function lastLine(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    return lines[lines.length - 1].slice(0, 300);
  } catch {
    return '';
  }
}

function runAgent(run, log, runFile, spawnAgent, extraEnv = {}, timeoutMs = 0) {
  const args = ['-p', '--force', '--output-format', 'text', '--workspace', run.worktree, ...(run.model ? ['--model', run.model] : []), run.prompt];
  return new Promise((resolve) => {
    let done = false;
    const finish = (code) => { if (!done) { done = true; resolve(code); } };
    const child = spawnAgent(run.agentBin, args, {
      cwd: run.worktree, env: { ...process.env, REPORT_AUTOFIX_RUN: run.id, ...extraEnv }, stdio: ['ignore', log, log],
    });
    if (child.pid) writeRun(runFile, { agentPid: child.pid });
    if (timeoutMs) {
      const timer = setTimeout(() => {
        fs.writeSync(log, `Stopped the agent after ${Math.round(timeoutMs / 1000)}s\n`);
        child.kill('SIGTERM');
        finish('timeout');
      }, timeoutMs);
      child.on('exit', () => clearTimeout(timer));
    }
    child.on('error', (err) => {
      fs.writeSync(log, `Could not start the Cursor agent: ${err.message}\n`);
      finish(null);
    });
    child.on('exit', finish);
  });
}

function step(runFile, text) {
  return writeRun(runFile, { step: text, stepAt: new Date().toISOString() });
}

const buildDirFor = (run) => path.join(os.tmpdir(), `omsking-autofix-build-${run.id}`);

/** Tasks this run marked done (Awaiting apply): the ones the verification has to prove. */
function doneTasks(run) {
  try {
    return runTasks(fs.readFileSync(path.join(run.outDir, 'TASKS.md'), 'utf8'), run.id);
  } catch {
    return [];
  }
}

/** Files the fixer changed in the worktree, new ones included, without the linked ignored folders. */
function changedPaths(worktree, base) {
  const list = (args) => git(worktree, args).split('\n').filter(Boolean);
  const all = [...list(['diff', '--name-only', base]), ...list(['ls-files', '--others', '--exclude-standard'])];
  return [...new Set(all)].filter((f) => !LINKS.some((l) => f === l || f.startsWith(`${l}/`))).sort();
}

function shell(cmd, cwd, log) {
  return new Promise((resolve) => {
    execFile('sh', ['-c', cmd], { cwd, env: process.env, timeout: CHECK_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`;
      fs.writeSync(log, `$ ${cmd}\n${out}\n`);
      resolve({ ok: !err, tail: out.trim().split('\n').slice(-15).join('\n') });
    });
  });
}

/**
 * Only what the fix touched: its own test files and, for admin, the build. Whole suites would also fail on the
 * developer's unfinished work in the snapshot, which is not the fix's fault, and take minutes.
 */
function checkCommands(files, buildDir) {
  const tests = (dir) => files.filter((f) => f.startsWith(`${dir}/`) && f.endsWith('.test.js')).map((f) => f.slice(dir.length + 1));
  const checks = [];
  const admin = tests('apps/admin');
  if (admin.length) checks.push({ name: 'admin tests', cmd: `node --test ${admin.join(' ')}`, dir: 'apps/admin' });
  if (files.some((f) => f.startsWith('apps/admin/'))) checks.push({ name: 'admin build', cmd: `npx vite build --outDir ${buildDir} --emptyOutDir`, dir: 'apps/admin' });
  const backend = tests('apps/backend');
  if (backend.length) checks.push({ name: 'backend tests', cmd: `node --test ${backend.join(' ')}`, dir: 'apps/backend' });
  return checks;
}

/** The runner's own test and build run on the fixed copy; the fixer saying "tests pass" is not enough. */
async function defaultRunChecks(worktree, files, buildDir, log) {
  const results = [];
  for (const { name, cmd, dir } of checkCommands(files, buildDir)) results.push({ name, ...(await shell(cmd, path.join(worktree, dir), log)) });
  return results;
}

function reviewPrompt(run, tasks, verdictFile, checks) {
  const ids = tasks.map((t) => (t.message ? `${t.messageId} ("${t.message}")` : t.messageId)).join(', ');
  return [
    'You are the independent reviewer of an Auto-fix change, in a separate git worktree copy of the project.',
    'Do not change, create or delete any file in this copy, and do not run any report-inbox command that changes a task. Only read, and run tests.',
    `Task(s) to check: ${ids}. For each, read its whole block in client-reports/TASKS.md: the client message, Type and Notes, every collapsed block`
    + ' (Client reply, Developer input, attached messages), the media it links in client-reports/media (open each screenshot, and for a video its "Video frames" folder), and the Issue / Fix / Check lines the fixer wrote.'
    + ' A voice note cannot be listened to: judge from the text, and if a point depends only on the voice note, it is not met.',
    `See the change with: git diff ${run.base} and git status (new files).`,
    '1. List every requirement the client asked for, point by point, in the client\'s words (include what the screenshots show).',
    '2. For each point decide whether the change fully meets it in the real code path (find the screen, route or API the client meant), with file:line evidence.'
    + ' A point that is only partly done, done on a different screen than the client meant, or only covered by a test but not by the real screen, is NOT met.',
    `3. The runner already ran the fix's own tests and the build: ${checks.length ? checks.map((c) => `${c.name} ${c.ok ? 'passed' : 'failed'}`).join(', ') : 'no test file changed'}.`
    + ' Do not run whole test suites again; if you run a test file, use node --test --test-reporter=dot <file>. Check the new test really tests the client\'s problem. Failures in test files this change does not touch are not caused by it.',
    '4. Check nothing unrelated changed, no live integration (Delhivery, Shopify, Amazon, Myntra) is called, and no secret is printed.',
    'The dev servers do not run from this copy: judge the screens from the code, the screenshots and the tests.',
    `Write your verdict as JSON to ${verdictFile}:`,
    '{"pass": true|false, "reason": "<one line why>", "requirements": [{"point": "<client point>", "met": true|false, "evidence": "<file:line, or what is missing>"}]}',
    'pass is true only when every point is met and the tests pass. When unsure, pass is false. Be quick: a few minutes at most.',
  ].join('\n');
}

async function reviewFix(run, tasks, checks, { log, runFile, spawnAgent, attempt, reviewTimeoutMs = REVIEW_TIMEOUT_MS }) {
  const verdictFile = path.join(os.tmpdir(), `omsking-autofix-verdict-${run.id}-${attempt}.json`);
  fs.rmSync(verdictFile, { force: true });
  const prompt = reviewPrompt(run, tasks, verdictFile, checks);
  const code = await runAgent({ ...run, prompt }, log, runFile, spawnAgent, { REPORT_AUTOFIX_VERDICT: verdictFile }, reviewTimeoutMs);
  if (code === 'timeout') {
    fs.rmSync(verdictFile, { force: true });
    return { pass: false, reason: `The reviewer took too long (over ${Math.round(reviewTimeoutMs / 60000) || 1} min)`, requirements: [] };
  }
  let verdict = null;
  try { verdict = JSON.parse(fs.readFileSync(verdictFile, 'utf8')); } catch { /* no verdict */ }
  fs.rmSync(verdictFile, { force: true });
  if (!verdict || typeof verdict.pass !== 'boolean') {
    return { pass: false, reason: code === 0 ? 'The reviewer gave no verdict' : 'The reviewer stopped with an error', requirements: [] };
  }
  const requirements = (Array.isArray(verdict.requirements) ? verdict.requirements : []).map((r) => ({
    point: String(r?.point || '').slice(0, 300), met: r?.met === true, evidence: String(r?.evidence || '').slice(0, 300),
  }));
  const unmet = requirements.filter((r) => !r.met);
  const pass = verdict.pass === true && requirements.length > 0 && unmet.length === 0;
  const given = String(verdict.reason || '').slice(0, 300);
  const reason = pass ? given : given || (unmet[0] ? `Not met: ${unmet[0].point}` : 'The reviewer listed no client point');
  return { pass, reason, requirements };
}

/** Proves the run's done tasks: the runner's own checks first, then the reviewer against every client point. */
async function verifyFix(run, tasks, { log, runFile, spawnAgent, runChecks, attempt, reviewTimeoutMs }) {
  writeRun(runFile, { state: 'verifying', attempt });
  const files = changedPaths(run.worktree, run.base);
  fs.writeSync(log, `\n--- Verifying attempt ${attempt}: ${files.join(', ') || 'no file changed'} ---\n`);
  const planned = checkCommands(files, buildDirFor(run)).map((c) => c.name);
  step(runFile, `Running the tests and build${planned.length ? `: ${planned.join(', ')}` : ''}`);
  const checks = await runChecks(run.worktree, files, buildDirFor(run), log);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) return { pass: false, attempt, checks, review: null, reason: `${failed.map((c) => c.name).join(', ')} failed` };
  step(runFile, `The reviewer agent is checking every client point of ${tasks.length} task${tasks.length === 1 ? '' : 's'}`);
  const review = await reviewFix(run, tasks, checks, { log, runFile, spawnAgent, attempt, reviewTimeoutMs });
  return { pass: review.pass, attempt, checks, review, reason: review.reason };
}

function defaultHoldTasks(run) {
  return (runId, reason) => require('./reportInbox').holdRun({ outDir: run.outDir, runId, reason });
}

function defaultCompleteTasks(run) {
  return (runId) => require('./reportInbox').completeApplied({ settings: require('../src/config').supportLive, outDir: run.outDir, runId });
}

async function runAutofix(runFile, {
  spawnAgent = spawn, checkInbox = defaultCheckInbox, completeTasks, holdTasks, runChecks = defaultRunChecks, reviewTimeoutMs,
} = {}) {
  let run = writeRun(runFile, {
    state: 'preparing', runnerPid: process.pid, step: 'Checking the Report inbox', stepAt: new Date().toISOString(),
  });
  fs.mkdirSync(path.dirname(run.logFile), { recursive: true });
  const log = fs.openSync(run.logFile, 'a');
  let created = false;
  try {
    try {
      await checkInbox(run.outDir);
    } catch (err) {
      fs.writeSync(log, `Inbox check failed: ${err.message}. Going on with the task list as it is.\n`);
    }
    const tasksText = fs.readFileSync(path.join(run.outDir, 'TASKS.md'), 'utf8');
    const plan = planAutofix(tasksText, { scope: run.scope || 'all', messageId: run.target || '' });
    if (!plan) {
      writeRun(runFile, {
        state: 'finished', exitCode: 0, error: '', finishedAt: new Date().toISOString(), note: 'Nothing to fix: no report task is waiting, answered or pending',
      });
      return;
    }
    const lead = primary(plan);
    run = writeRun(runFile, {
      plan,
      messageId: lead.messageId,
      message: lead.message,
      candidates: candidates(plan),
      prompt: fixPrompt(plan, path.join(os.tmpdir(), `omsking-autofix-build-${run.id}`), tasksText),
    });

    const base = snapshot(run.repoDir);
    fs.mkdirSync(path.dirname(run.worktree), { recursive: true });
    git(run.repoDir, ['worktree', 'add', '--detach', run.worktree, base]);
    created = true;
    linkIgnored(run.repoDir, run.worktree);
    run = writeRun(runFile, { state: 'running', base });
    step(runFile, 'The fixer agent is working on the message');

    const exitCode = await runAgent(run, log, runFile, spawnAgent);
    await verifyAndFinish(run, exitCode, {
      log, runFile, spawnAgent, runChecks, completeTasks, holdTasks, reviewTimeoutMs,
    });
  } catch (err) {
    fs.writeSync(log, `Auto-fix runner failed: ${err.message}\n`);
    writeRun(runFile, {
      state: 'finished', exitCode: null, finishedAt: new Date().toISOString(), error: `Auto-fix runner failed: ${err.message.split('\n')[0]}`,
    });
  } finally {
    fs.closeSync(log);
    if (created) {
      unlinkIgnored(run.worktree);
      try { git(run.repoDir, ['worktree', 'remove', '--force', run.worktree]); } catch { /* already gone */ }
    }
  }
}

/**
 * After the fixer: verify its done tasks (one retry with the reviewer's reasons), then save the patch or drop it.
 * requireDone: a change with no task marked done is rejected instead of kept unverified (Verify fix).
 */
async function verifyAndFinish(run, exitCode, {
  log, runFile, spawnAgent, runChecks, completeTasks, holdTasks, reviewTimeoutMs, requireDone = false,
}) {
  let verification = null;
  if (requireDone && exitCode === 0 && !doneTasks(run).length) {
    verification = { pass: false, attempt: 1, checks: [], review: null, reason: 'No task of this run is marked done' };
  } else if (exitCode === 0 && doneTasks(run).length) {
    verification = await verifyFix(run, doneTasks(run), {
      log, runFile, spawnAgent, runChecks, reviewTimeoutMs, attempt: 1,
    });
  }
  const rejected = Boolean(verification && !verification.pass);
  unlinkIgnored(run.worktree);
  const { patch, files } = collectChange(run.worktree, run.base);
  let patchFile = null;
  let heldPatch = null;
  if (rejected) {
    if (patch) {
      heldPatch = run.logFile.replace(/\.log$/, '.unverified.patch');
      fs.writeFileSync(heldPatch, `${patch}\n`);
    }
    const saved = heldPatch ? ` The change is saved in ${heldPatch}` : '';
    try {
      (holdTasks || defaultHoldTasks(run))(run.id, `Not verified yet: ${verification.reason}.${saved}`);
    } catch (err) {
      fs.writeSync(log, `Could not put the tasks back In progress: ${err.message}\n`);
    }
    fs.writeSync(log, `Not verified, left In progress: ${verification.reason}\n`);
  } else if (patch) {
    patchFile = run.logFile.replace(/\.log$/, '.patch');
    fs.writeFileSync(patchFile, `${patch}\n`);
  } else {
    try {
      await (completeTasks || defaultCompleteTasks(run))(run.id);
    } catch (err) {
      fs.writeSync(log, `Could not mark the tasks Complete: ${err.message}. Run: npm run report-inbox -- --applied ${run.id}\n`);
    }
  }
  writeRun(runFile, {
    state: 'finished',
    exitCode,
    finishedAt: new Date().toISOString(),
    error: exitCode === 0 ? '' : lastLine(run.logFile) || 'The Cursor agent stopped with an error',
    patchFile,
    heldPatch,
    changedFiles: rejected ? [] : files,
    applied: false,
    verification,
    step: 'Done',
    stepAt: new Date().toISOString(),
    ...(rejected ? { note: `Left In progress, not verified: ${verification.reason}` } : {}),
  });
}

/** Verify fix: a saved change that was never verified is applied to a fresh copy of its base and goes through the same checks. */
async function verifyAutofix(runFile, {
  spawnAgent = spawn, completeTasks, holdTasks, runChecks = defaultRunChecks, reviewTimeoutMs,
} = {}) {
  let run = writeRun(runFile, {
    state: 'verifying', runnerPid: process.pid, verification: null, step: 'Setting up a copy of the saved change', stepAt: new Date().toISOString(),
  });
  const log = fs.openSync(run.logFile, 'a');
  let created = false;
  try {
    fs.writeSync(log, '\n--- Verify fix: checking the saved change of this run ---\n');
    const worktree = path.join(path.dirname(run.worktree), `${run.id}-verify`);
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    git(run.repoDir, ['worktree', 'add', '--detach', worktree, run.base]);
    created = true;
    run = writeRun(runFile, { worktree });
    git(worktree, ['apply', '--whitespace=nowarn', run.patchFile]);
    linkIgnored(run.repoDir, worktree);
    await verifyAndFinish(run, 0, {
      log, runFile, spawnAgent, runChecks, completeTasks, holdTasks, reviewTimeoutMs, requireDone: true,
    });
  } catch (err) {
    fs.writeSync(log, `Verify fix failed: ${err.message}\n`);
    writeRun(runFile, { state: 'finished', finishedAt: new Date().toISOString(), error: `Verify fix failed: ${err.message.split('\n')[0]}` });
  } finally {
    fs.closeSync(log);
    if (created) {
      unlinkIgnored(run.worktree);
      try { git(run.repoDir, ['worktree', 'remove', '--force', run.worktree]); } catch { /* already gone */ }
    }
  }
}

/** nodemon kills the dev server's whole process tree on restart; a grandchild re-parented away from it survives. */
function launch(runFile, { spawnRunner = spawn, mode = '' } = {}) {
  const child = spawnRunner(process.execPath, [__filename, runFile, ...(mode ? [mode] : [])], { cwd: process.cwd(), env: process.env, detached: true, stdio: 'ignore' });
  writeRun(runFile, { runnerPid: child.pid });
  child.unref();
}

if (require.main === module) {
  const runFile = path.resolve(process.argv[2]);
  if (process.argv[3] === '--launch') {
    launch(runFile, { mode: process.argv[4] === '--verify' ? '--verify' : '' });
    process.exit(0);
  }
  (process.argv[3] === '--verify' ? verifyAutofix(runFile) : runAutofix(runFile)).then(() => process.exit(0));
}

module.exports = { runAutofix, verifyAutofix, launch, checkCommands };
