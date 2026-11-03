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
const { execFileSync, spawn } = require('child_process');
const { runOnce, planAutofix } = require('./reportInbox');

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

function fixSteps(id, buildDir) {
  return [
    `   - Mark it started: npm run report-inbox -- --mark in-progress ${id} (in apps/backend).`,
    '   - Read the task, its notes, its collapsed blocks and screenshots in client-reports/TASKS.md, and the relevant code. Write a failing automated test first, then the smallest fix.',
    `   - Re-run the new test and the affected suites (backend: npm test in apps/backend; admin: node --test src/lib/*.test.js src/pages/admin/*.test.js in apps/admin), plus for admin changes: npx vite build --outDir ${buildDir} --emptyOutDir.`,
    `   - Only when they all pass: npm run report-inbox -- --mark complete ${id} <ids of tasks marked "Part of: ${id}"> --issue "<issue kya tha>" --fix "<fix kya kiya>"`
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
function fixPrompt(plan, buildDir) {
  const lines = [
    'You are in a separate git worktree copy of the project: the developer keeps working in the main folder at the same time, so only change files inside this copy. The dev servers do not run from this copy, so skip browser checks; the developer applies your change afterwards.',
    'Follow .cursor/rules/report-fix-loop.mdc and .cursor/rules/omsking-qa.mdc. Fix at most one task in this run (plus one fallback task only where it says so).',
    '',
  ];
  if (plan.kind === 'next') {
    lines.push(`Fix the client Report task ${plan.task.messageId} ("${plan.task.message}") in client-reports/TASKS.md:`, fixSteps(plan.task.messageId, buildDir), askOrNext(plan.task.messageId, plan.next));
  } else if (plan.kind === 'replied') {
    const { task } = plan;
    lines.push(
      `Task ${task.messageId} ("${task.message}") was waiting for the client${task.need ? ` (needed: ${task.need})` : ''}. The client's answer is attached under it in client-reports/TASKS.md as a collapsed "Client reply" block, so the requirement is fulfilled. Fix it now:`,
      fixSteps(task.messageId, buildDir),
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
    if (plan.next) lines.push(fixSteps(plan.next.messageId, buildDir), askOrNext(plan.next.messageId, null));
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

function runAgent(run, log, runFile, spawnAgent) {
  const args = ['-p', '--force', '--output-format', 'text', '--workspace', run.worktree, ...(run.model ? ['--model', run.model] : []), run.prompt];
  return new Promise((resolve) => {
    let done = false;
    const finish = (code) => { if (!done) { done = true; resolve(code); } };
    const child = spawnAgent(run.agentBin, args, {
      cwd: run.worktree, env: { ...process.env, REPORT_AUTOFIX_RUN: run.id }, stdio: ['ignore', log, log],
    });
    if (child.pid) writeRun(runFile, { agentPid: child.pid });
    child.on('error', (err) => {
      fs.writeSync(log, `Could not start the Cursor agent: ${err.message}\n`);
      finish(null);
    });
    child.on('exit', finish);
  });
}

function defaultCompleteTasks(run) {
  return (runId) => require('./reportInbox').completeApplied({ settings: require('../src/config').supportLive, outDir: run.outDir, runId });
}

async function runAutofix(runFile, { spawnAgent = spawn, checkInbox = defaultCheckInbox, completeTasks } = {}) {
  let run = writeRun(runFile, { state: 'preparing', runnerPid: process.pid });
  fs.mkdirSync(path.dirname(run.logFile), { recursive: true });
  const log = fs.openSync(run.logFile, 'a');
  let created = false;
  try {
    try {
      await checkInbox(run.outDir);
    } catch (err) {
      fs.writeSync(log, `Inbox check failed: ${err.message}. Going on with the task list as it is.\n`);
    }
    const plan = planAutofix(fs.readFileSync(path.join(run.outDir, 'TASKS.md'), 'utf8'));
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
      prompt: fixPrompt(plan, path.join(os.tmpdir(), `omsking-autofix-build-${run.id}`)),
    });

    const base = snapshot(run.repoDir);
    fs.mkdirSync(path.dirname(run.worktree), { recursive: true });
    git(run.repoDir, ['worktree', 'add', '--detach', run.worktree, base]);
    created = true;
    linkIgnored(run.repoDir, run.worktree);
    run = writeRun(runFile, { state: 'running', base });

    const exitCode = await runAgent(run, log, runFile, spawnAgent);
    unlinkIgnored(run.worktree);
    const { patch, files } = collectChange(run.worktree, base);
    let patchFile = null;
    if (patch) {
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
      changedFiles: files,
      applied: false,
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

if (require.main === module) runAutofix(path.resolve(process.argv[2])).then(() => process.exit(0));

module.exports = { runAutofix };
