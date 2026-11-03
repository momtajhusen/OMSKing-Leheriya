import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { GitMerge, Loader2, Trash2, Wand2 } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { isLocalHost } from '../../lib/devHost';

const POLL_MS = 5000;
const IDLE_POLL_MS = 30000;
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
  const apply = run.changedFiles.length ? ' Click Apply fix to bring the change into your files.' : '';
  toast.success(`Auto-fix finished — ${touched}.${apply}`, { duration: 10000 });
}

function nextTitle(next) {
  if (!next) return 'No report task is waiting or pending';
  if (next.kind === 'replied') return `The client replied about "${next.message}" — click to fix it`;
  if (next.kind === 'waiting') return `Checks ${next.waiting} task(s) waiting for the client against the history, else fixes the next pending task`;
  return `Fixes the next report task: "${next.message}"`;
}

function AutoFixControl() {
  const [run, setRun] = useState(null);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState('');
  const wasRunning = useRef(false);
  const running = Boolean(run?.running);
  const replyReady = next?.kind === 'replied';
  const canApply = Boolean(run && !run.running && run.patchFile && !run.applied && !run.discarded);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/dev/report-autofix');
      const current = data.data?.run || null;
      setRun(current);
      setNext(data.data?.next || null);
      if (wasRunning.current && current && !current.running) finishedToast(current);
      wasRunning.current = Boolean(current?.running);
    } catch {
      /* the button is best effort */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = setInterval(load, running ? POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const start = async () => {
    setBusy('start');
    try {
      const { data } = await api.post('/dev/report-autofix');
      setRun(data.data);
      wasRunning.current = true;
      toast('Auto-fix started: checking the inbox, then fixing', { icon: '🛠️' });
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
    } catch (err) {
      toast.error(apiError(err, 'Could not apply the fix'), { duration: 10000 });
    } finally {
      setBusy('');
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

  const startTitle = canApply ? 'Apply or discard the last change first' : `${nextTitle(next)} (localhost only)`;

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={running || canApply || Boolean(busy)}
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
      {canApply && (
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
