const fs = require('fs');
const path = require('path');
const express = require('express');
const { spawn: spawnProcess, execFile } = require('child_process');
const {
  planAutofix, taskStatus, taskSummaries, completeApplied, discardRun,
} = require('../../scripts/reportInbox');

const RUNNER = path.resolve(__dirname, '../../scripts/autofixRunner.js');
const ACTIVE = new Set(['starting', 'preparing', 'running']);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** The agent loads apps/backend/.env itself when it runs npm scripts, so only these reach it from the backend. */
const AGENT_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TMPDIR', 'TERM', 'CURSOR_API_KEY'];

/** True only for a request made on this machine to localhost (a proxied public request has another Host). */
function isLocalRequest(req) {
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return LOOPBACK.has(req.socket.remoteAddress) && LOCAL_HOSTS.has(host);
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** What the next click would work on, for the button's tooltip; the runner makes the real plan after its inbox check. */
function preview(plan) {
  if (!plan) return null;
  const lead = plan.kind === 'waiting' ? plan.waiting[0] : plan.task;
  return { kind: plan.kind, messageId: lead.messageId, message: lead.message, waiting: plan.kind === 'waiting' ? plan.waiting.length : 0 };
}

/**
 * Local-only route behind the header Auto-fix button. POST starts scripts/autofixRunner.js as a detached process, which
 * checks the inbox and picks the work (client replies, then waiting tasks, then the next pending one); the run is kept
 * in client-reports/autofix/current.json, so the button finds it again after a backend restart. POST /apply copies the
 * finished fix into the main checkout. Answers 404 unless enabled and the request is made on this machine to localhost.
 */
function createReportAutofix({
  enabled, agentBin, model = '', repoDir, outDir, worktreeRoot, guards = [], spawn = spawnProcess, env = process.env, liveSettings,
  completeTasks = (runId) => completeApplied({ settings: liveSettings, outDir, runId }),
  discardTasks = (runId, reason) => discardRun({ outDir, runId, reason }),
}) {
  const router = express.Router();
  const tasksFile = path.join(outDir, 'TASKS.md');
  const runDir = path.join(outDir, 'autofix');
  const runFile = path.join(runDir, 'current.json');

  const tasksText = () => {
    try { return fs.readFileSync(tasksFile, 'utf8'); } catch { return ''; }
  };
  const saveRun = (run) => {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(`${runFile}.tmp`, JSON.stringify(run, null, 2));
    fs.renameSync(`${runFile}.tmp`, runFile);
    return run;
  };
  const readRun = () => {
    let run;
    try { run = JSON.parse(fs.readFileSync(runFile, 'utf8')); } catch { return null; }
    if (ACTIVE.has(run.state) && !alive(run.runnerPid)) {
      run = saveRun({
        ...run, state: 'finished', exitCode: null, finishedAt: new Date().toISOString(), error: 'The Auto-fix runner stopped before the agent finished',
      });
    }
    return run;
  };
  const view = (run) => run && {
    id: run.id,
    messageId: run.messageId || null,
    message: run.message || '',
    plan: run.plan?.kind || null,
    tasks: (run.candidates || []).map((id) => ({ messageId: id, status: taskStatus(tasksText(), id) })),
    note: run.note || '',
    state: run.state,
    running: ACTIVE.has(run.state),
    startedAt: run.startedAt || null,
    finishedAt: run.finishedAt || null,
    exitCode: run.exitCode ?? null,
    error: run.error || '',
    status: taskStatus(tasksText(), run.messageId),
    worktree: run.worktree || null,
    logFile: run.logFile || null,
    patchFile: run.patchFile || null,
    changedFiles: run.changedFiles || [],
    applied: Boolean(run.applied),
    discarded: run.discarded || null,
  };
  /** A finished run whose change is neither applied nor discarded: its tasks are still Awaiting apply. */
  const pendingChange = (run) => Boolean(run && !ACTIVE.has(run.state) && run.patchFile && !run.applied && !run.discarded);

  router.use((req, res, next) => (enabled && isLocalRequest(req)
    ? next()
    : res.status(404).json({ success: false, message: 'Not found', data: null })));
  if (guards.length) router.use(...guards);

  router.get('/summaries', (req, res) => {
    res.json({ success: true, data: taskSummaries(tasksText()) });
  });

  router.get('/', (req, res) => {
    res.json({ success: true, data: { run: view(readRun()), next: preview(planAutofix(tasksText())) } });
  });

  router.post('/', (req, res) => {
    const current = readRun();
    if (current && ACTIVE.has(current.state)) {
      return res.status(409).json({ success: false, message: 'An Auto-fix is already running', data: view(current) });
    }
    if (pendingChange(current)) {
      return res.status(409).json({ success: false, message: 'Apply or discard the last Auto-fix change first', data: view(current) });
    }
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    const run = saveRun({
      id,
      state: 'starting',
      startedAt: new Date().toISOString(),
      repoDir,
      outDir,
      worktree: path.join(worktreeRoot, id),
      logFile: path.join(runDir, `${id}.log`),
      agentBin,
      model,
    });
    const childEnv = Object.fromEntries(AGENT_ENV.filter((k) => env[k]).map((k) => [k, env[k]]));
    const child = spawn(process.execPath, [RUNNER, runFile], { cwd: repoDir, env: childEnv, detached: true, stdio: 'ignore' });
    child.on('error', (err) => saveRun({
      ...readRun(), state: 'finished', exitCode: null, finishedAt: new Date().toISOString(), error: `Could not start the Auto-fix runner: ${err.message}`,
    }));
    child.unref();
    return res.status(202).json({ success: true, data: view(saveRun({ ...run, runnerPid: child.pid })) });
  });

  router.post('/apply', (req, res) => {
    const run = readRun();
    if (!pendingChange(run)) {
      return res.status(409).json({ success: false, message: 'No finished Auto-fix change is waiting to be applied', data: view(run) });
    }
    return execFile('git', ['apply', '--whitespace=nowarn', run.patchFile], { cwd: repoDir }, (err, stdout, stderr) => {
      if (err) {
        const reason = String(stderr || err.message).trim().split('\n')[0];
        return res.status(409).json({ success: false, message: `The fix does not apply cleanly to your files (${reason}). Patch: ${run.patchFile}`, data: view(run) });
      }
      const applied = saveRun({ ...run, applied: true, appliedAt: new Date().toISOString() });
      return Promise.resolve()
        .then(() => completeTasks(run.id))
        .then((completed) => res.json({ success: true, data: { ...view(applied), completed } }))
        .catch((e) => res.status(502).json({
          success: false,
          message: `The fix is in your files, but its tasks could not be marked Complete (${e.message}). Run: npm run report-inbox -- --applied ${run.id}`,
          data: view(applied),
        }));
    });
  });

  router.post('/discard', (req, res) => {
    const run = readRun();
    if (!pendingChange(run)) {
      return res.status(409).json({ success: false, message: 'No finished Auto-fix change is waiting to be discarded', data: view(run) });
    }
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ success: false, message: 'Say why the change is discarded', data: view(run) });
    const tasks = discardTasks(run.id, reason);
    const saved = saveRun({ ...run, discarded: { reason, at: new Date().toISOString() } });
    return res.json({ success: true, data: { ...view(saved), failed: tasks } });
  });

  return router;
}

module.exports = { createReportAutofix, isLocalRequest };
