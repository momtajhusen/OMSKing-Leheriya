import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { GitMerge, HelpCircle, Loader2, ShieldCheck, Trash2, Wand2 } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { isLocalHost } from '../../lib/devHost';
import { inputDraft, nearbyText } from '../../lib/autofixInputs';
import { inputGuide } from '../../lib/inputGuide';
import { serverRestarting } from '../../lib/authErrors';
import { focusReportMessage, notifyAutofixChanged, onAutofixChanged } from '../../lib/reportFocus';
import InputGuide from './InputGuide';
import {
  autoplayOn, autoplayPhase, autoplaySince, autoplayStep, autoplayTarget, targetReached, loadAutoplayLog, logRun, onAutoplayChanged, publishAutoplayStatus, rejectedRun, saveAutoplayLog, setAutoplay, shouldAutoApply, shouldAutoVerify,
} from '../../lib/autofixAutoplay';
import { taskPage } from '../../lib/taskPage';
import { ROUTE_DEFS } from '../../router';

const POLL_MS = 5000;
const IDLE_POLL_MS = 30000;
const RESTART_POLL_MS = 2000;
const RESTART_WAIT_MS = 60000;
const BUTTON = 'relative inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors disabled:opacity-60';

/** Localhost-only header button: starts the Cursor agent on the next Report work (client replies, waiting tasks, then pending). */
export default function AutoFixButton() {
  if (!isLocalHost(window.location.hostname)) return null;
  return <AutoFixControl />;
}

function finishedToast(run) {
  if (run.note) {
    toast(run.note, { duration: 8000 });
    return;
  }
  if (run.error) {
    toast.error(`Auto-fix stopped: ${run.error}`, { duration: 10000 });
    return;
  }
  const touched = run.tasks.filter((t) => t.status && t.status !== 'Not started').map((t) => t.status).join(', ') || 'no task changed';
  const apply = run.changedFiles.length ? ' Applying the change to your files now.' : '';
  toast.success(`Auto-fix finished — ${touched}.${apply}`, { duration: 10000 });
}

/** Polls until the backend answers again; resolves with the run, or null if it stays down. */
async function waitForServer() {
  const until = Date.now() + RESTART_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((resolve) => { setTimeout(resolve, RESTART_POLL_MS); });
    try {
      const { data } = await api.get('/dev/report-autofix');
      return data.data?.run || null;
    } catch {
      /* still restarting */
    }
  }
  return null;
}

function nextTitle(next) {
  if (!next) return 'No report task is waiting or pending';
  if (next.kind === 'replied') return `The client replied about "${next.message}" — click to fix it`;
  if (next.kind === 'resume') return `Finishes "${next.message}", left In progress by a stopped run`;
  if (next.kind === 'waiting') return `Checks ${next.waiting} task(s) waiting for the client against the history, else fixes the next pending task`;
  return `Fixes the next report task: "${next.message}"`;
}

function AutoFixControl() {
  const navigate = useNavigate();
  const [run, setRun] = useState(null);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState('');
  const [inputs, setInputs] = useState([]);
  const [showInputs, setShowInputs] = useState(false);
  const wasRunning = useRef(false);
  const [autoplay, setAutoplayState] = useState(autoplayOn);
  const loop = useRef({ busy: false, prevMessageId: null });
  const tick = useRef(null);
  const autoApplyFailed = useRef(null);
  const autoVerifyFailed = useRef(null);
  const running = Boolean(run?.running);
  const replyReady = next?.kind === 'replied';
  const hasChange = Boolean(run && !run.running && run.patchFile && !run.applied && !run.discarded);
  const canApply = hasChange && run.verification?.pass === true;
  const needsVerify = hasChange && !run.verification;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/dev/report-autofix');
      const current = data.data?.run || null;
      setRun(current);
      setNext(data.data?.next || null);
      if (wasRunning.current && current && !current.running) finishedToast(current);
      wasRunning.current = Boolean(current?.running);
      if (autoplayOn()) {
        const log = logRun(loadAutoplayLog(), current);
        saveAutoplayLog(log);
        publishAutoplayStatus({ run: current, next: data.data?.next || null, progress: data.data?.progress || null, log, phase: autoplayPhase(current) });
      }
      tick.current?.(current);
      const asked = await api.get('/dev/report-autofix/inputs');
      setInputs(asked.data.data || []);
    } catch {
      /* the button is best effort */
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onAutofixChanged(load), [load]);
  useEffect(() => onAutoplayChanged((on) => {
    setAutoplayState(on);
    loop.current.prevMessageId = null;
    if (on) load();
  }), [load]);

  useEffect(() => {
    const timer = setInterval(load, running || autoplay ? POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [running, autoplay, load]);

  const start = async () => {
    setBusy('start');
    try {
      const { data } = await api.post('/dev/report-autofix');
      setRun(data.data);
      wasRunning.current = true;
      toast('Auto-fix started: checking the inbox, then fixing', { icon: '🛠️' });
      const task = data.data?.messageId ? data.data : next;
      const page = taskPage(task, ROUTE_DEFS.admin);
      if (page) navigate(page);
      focusReportMessage(task?.messageId);
    } catch (err) {
      toast.error(apiError(err, 'Could not start the auto-fix'));
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    setBusy('apply');
    try {
      const { data } = await api.post('/dev/report-autofix/apply');
      setRun(data.data);
      const done = data.data.completed?.length ? ` · ${data.data.completed.length} task(s) marked Complete` : '';
      toast.success(`Fix applied to your files: ${data.data.changedFiles.join(', ')}${done}`, { duration: 8000 });
      return true;
    } catch (err) {
      const latest = rejectedRun(err);
      if (latest) setRun(latest);
      if (latest?.applied) {
        toast.success('This fix is already applied to your files', { id: 'autofix-apply', duration: 6000 });
        return true;
      }
      if (!serverRestarting(err)) {
        toast.error(apiError(err, 'Could not apply the fix'), { id: 'autofix-apply', duration: 10000 });
        if (autoplayOn()) setAutoplay(false);
        return false;
      }
      const waiting = toast.loading('The server is restarting after the change — checking the fix…');
      const current = await waitForServer();
      toast.dismiss(waiting);
      if (current?.applied) toast.success('Fix applied to your files and its tasks marked Complete', { duration: 8000 });
      else if (current) toast('The server is back. The fix was not applied yet — click Apply fix again.', { duration: 10000 });
      else toast.error('The server is not answering yet. Wait a moment and click Apply fix again.', { duration: 10000 });
      await load();
    } finally {
      setBusy('');
    }
  };

  const verify = async () => {
    setBusy('verify');
    try {
      const { data } = await api.post('/dev/report-autofix/verify');
      setRun(data.data);
      wasRunning.current = true;
      toast('Verifying the saved change against the client requirement…', { icon: '🔍' });
      return true;
    } catch (err) {
      if (serverRestarting(err)) return null;
      toast.error(apiError(err, 'Could not verify the change'), { duration: 10000 });
      return false;
    } finally {
      setBusy('');
    }
  };

  const startPending = async () => {
    try {
      const { data } = await api.post('/dev/report-autofix', { scope: 'pending' });
      setRun(data.data);
      wasRunning.current = true;
      toast('Pending auto-play: fixing the next message', { icon: '▶️' });
      const task = data.data?.messageId ? data.data : data.data?.next;
      const page = taskPage(task, ROUTE_DEFS.admin);
      if (page) navigate(page);
      focusReportMessage(task?.messageId);
    } catch (err) {
      if (serverRestarting(err)) return;
      setAutoplay(false);
      const message = apiError(err, 'Could not start the auto-fix');
      if (/Nothing to auto-fix/.test(message)) toast.success('Pending auto-play finished: no pending message is left', { duration: 8000 });
      else toast.error(`Pending auto-play paused: ${message}`, { duration: 10000 });
    }
  };

  tick.current = async (current) => {
    if (loop.current.busy) return;
    if (!autoplayOn()) {
      const applyIt = shouldAutoApply(current, autoApplyFailed.current);
      if (!applyIt && !shouldAutoVerify(current, autoVerifyFailed.current)) return;
      loop.current.busy = true;
      try {
        if (applyIt) {
          if (await apply() === false) autoApplyFailed.current = current.id;
        } else if (await verify() === false) {
          autoVerifyFailed.current = current.id;
        }
      } finally {
        loop.current.busy = false;
      }
      return;
    }
    const step = autoplayStep(current, loop.current.prevMessageId, autoplaySince());
    if (step.action === 'wait') return;
    if (step.action === 'stop') {
      setAutoplay(false);
      toast.error(`Pending auto-play paused: ${step.reason}`, { duration: 10000 });
      return;
    }
    loop.current.busy = true;
    try {
      if (step.action === 'apply') {
        if (await apply() === false) autoApplyFailed.current = current.id;
      } else if (step.action === 'verify') {
        if (await verify() === false) {
          autoVerifyFailed.current = current.id;
          setAutoplay(false);
        }
      } else if (targetReached(loadAutoplayLog(), autoplayTarget())) {
        setAutoplay(false);
        toast.success(`Pending auto-play finished: ${autoplayTarget()} message(s) Complete`, { duration: 8000 });
      } else {
        loop.current.prevMessageId = current?.messageId || null;
        await startPending();
      }
    } finally {
      loop.current.busy = false;
    }
  };

  const discard = async () => {
    const reason = (window.prompt('Why discard this Auto-fix change? Its tasks will be marked Fix failed with this reason.') || '').trim();
    if (!reason) return;
    setBusy('discard');
    try {
      const { data } = await api.post('/dev/report-autofix/discard', { reason });
      setRun(data.data);
      toast(`Auto-fix change discarded · ${data.data.failed.length} task(s) marked Fix failed`);
    } catch (err) {
      toast.error(apiError(err, 'Could not discard the change'));
    } finally {
      setBusy('');
    }
  };

  const startTitle = hasChange ? 'Apply or discard the last change first' : `${nextTitle(next)} (localhost only)`;

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={running || hasChange || Boolean(busy)}
        title={running ? `Fixing in a separate copy${run.message ? `: ${run.message}` : ''}` : startTitle}
        className={`${BUTTON} text-foreground/80 hover:bg-[hsl(var(--color-muted))] hover:text-foreground`}
      >
        {running || busy === 'start' ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Wand2 className="h-[18px] w-[18px]" />}
        <span className="hidden sm:inline">{running ? 'Fixing…' : 'Auto-fix'}</span>
        {replyReady && !running && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#00a884] ring-2 ring-[hsl(var(--color-card-bg))]" aria-label="Client replied" />
        )}
      </button>
      {canApply && (
        <button
          type="button"
          onClick={apply}
          disabled={Boolean(busy)}
          title={`Copy the Auto-fix change into your files: ${run.changedFiles.join(', ')}`}
          className={`${BUTTON} bg-emerald-600 text-white hover:bg-emerald-700`}
        >
          {busy === 'apply' ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <GitMerge className="h-[18px] w-[18px]" />}
          <span className="hidden sm:inline">Apply fix</span>
        </button>
      )}
      {needsVerify && (
        <button
          type="button"
          onClick={verify}
          disabled={Boolean(busy)}
          title="This change was never checked: run the tests and review it against every client point before it can be applied"
          className={`${BUTTON} bg-amber-600 text-white hover:bg-amber-700`}
        >
          {busy === 'verify' ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <ShieldCheck className="h-[18px] w-[18px]" />}
          <span className="hidden sm:inline">Verify fix</span>
        </button>
      )}
      {inputs.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowInputs((v) => !v)}
            title="Auto-fix could not understand these tasks, even with the messages around them: say what is needed"
            className={`${BUTTON} text-amber-700 hover:bg-[hsl(var(--color-muted))]`}
          >
            <HelpCircle className="h-[18px] w-[18px]" />
            <span className="hidden sm:inline">Needs input ({inputs.length})</span>
          </button>
          {showInputs && (
            <div className="absolute right-0 top-11 z-50 max-h-[70vh] w-[min(26rem,90vw)] space-y-2 overflow-y-auto rounded-xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card-bg))] p-3 shadow-xl">
              {inputs.map((request, index) => (
                <InputForm key={request.messageId} request={request} open={index === 0} onSent={load} />
              ))}
            </div>
          )}
        </div>
      )}
      {hasChange && (
        <button
          type="button"
          onClick={discard}
          disabled={Boolean(busy)}
          title="Do not apply this change: its tasks become Fix failed with your reason"
          className={`${BUTTON} text-foreground/70 hover:bg-[hsl(var(--color-muted))] hover:text-foreground`}
        >
          {busy === 'discard' ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Trash2 className="h-[18px] w-[18px]" />}
          <span className="hidden sm:inline">Discard</span>
        </button>
      )}
    </>
  );
}

function InputForm({ request, open, onSent }) {
  const [to, setTo] = useState(request.from === 'client' ? 'client' : 'developer');
  const [text, setText] = useState(() => (to === 'client' ? inputDraft(request, 'client') : ''));
  const [sending, setSending] = useState(false);
  const guide = inputGuide(request);
  const around = nearbyText(request.nearby);

  const pickTo = (value) => {
    setTo(value);
    setText(value === 'client' ? inputDraft(request, 'client') : '');
  };

  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const body = to === 'client' ? text : inputDraft(request, 'developer', text.trim());
      await api.post(`/dev/report-autofix/inputs/${request.messageId}`, { text: body, to });
      if (to === 'client') {
        toast.success(guide.asked);
      } else {
        try {
          await api.post('/dev/report-autofix', { messageId: request.messageId });
          toast.success(guide.started, { duration: 8000 });
        } catch {
          toast(guide.queued, { duration: 9000 });
        }
        notifyAutofixChanged();
      }
      onSent();
    } catch (err) {
      toast.error(apiError(err, 'Could not save the input'));
    } finally {
      setSending(false);
    }
  };

  return (
    <details open={open} className="rounded-lg border border-[hsl(var(--color-border))] p-2 text-sm">
      <summary className="cursor-pointer font-medium">{request.message}</summary>
      <form onSubmit={send} className="mt-2 space-y-2">
        <InputGuide guide={guide} />
        {around && <p className="whitespace-pre-line text-xs text-foreground/60">{around}</p>}
        {to === 'developer' && request.options.length > 0 && (
          <div>
            <p className="mb-1 text-xs text-foreground/60">{guide.optionsLabel}</p>
            <div className="flex flex-wrap gap-1">
              {request.options.map((option) => (
                <button key={option} type="button" onClick={() => setText(option)} className="rounded-full border border-[hsl(var(--color-border))] px-2 py-0.5 text-xs hover:bg-[hsl(var(--color-muted))]">
                  {option}
                </button>
              ))}
            </div>
          </div>
        )}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={guide.placeholder} aria-label={guide.needLabel} className="w-full rounded-md border border-[hsl(var(--color-border))] bg-transparent p-2 text-sm" />
        <div className="flex items-center justify-between gap-2">
          <select value={to} onChange={(e) => pickTo(e.target.value)} className="rounded-md border border-[hsl(var(--color-border))] bg-transparent px-2 py-1 text-xs">
            <option value="developer">{guide.toDeveloper}</option>
            <option value="client">{guide.toClient}</option>
          </select>
          <button type="submit" disabled={sending || !text.trim()} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-60">
            {sending && <Loader2 className="h-3 w-3 animate-spin" />} {guide.submit}
          </button>
        </div>
      </form>
    </details>
  );
}
