import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import toast from 'react-hot-toast';
import {
  Loader2, MessageSquareWarning, Pause, Play, SendHorizontal, Square,
} from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { formatDuration } from '../../lib/reportChat';
import screenRecorder from '../../lib/screenRecorder';
import { onReportFocus } from '../../lib/reportFocus';
import ReportChat from './ReportChat';

const UNREAD_POLL_MS = 30000;

/** Header "Report" button. `mode="merchant"` opens the company's chat with Developer Support; `mode="platform"` opens the subscriber inbox. */
export default function ReportButton({ mode = 'merchant', className }) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState(null);
  const [unread, setUnread] = useState(0);
  const [sending, setSending] = useState(false);
  const [focusId, setFocusId] = useState(null);
  const known = useRef(null);
  const openRef = useRef(open);
  openRef.current = open;
  const rec = useSyncExternalStore(screenRecorder.subscribe, screenRecorder.getState);
  const recording = rec.status !== 'idle';
  const paused = rec.status === 'paused';

  const loadUnread = useCallback(async () => {
    try {
      const { data } = mode === 'platform'
        ? await api.get('/support/threads')
        : await api.get('/support/unread');
      const count = mode === 'platform' ? Number(data.meta?.unread || 0) : Number(data.data?.unread || 0);
      if (known.current !== null && count > known.current && !openRef.current) {
        toast(mode === 'platform' ? 'New report from a subscriber' : 'New reply from Developer Support', { icon: '💬' });
      }
      known.current = count;
      setUnread(count);
    } catch {
      /* badge is best effort */
    }
  }, [mode]);

  useEffect(() => {
    loadUnread();
    const timer = setInterval(() => { if (!document.hidden) loadUnread(); }, UNREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [loadUnread]);

  /** A stopped recording reopens the report on the chat it was recorded from, staged for a caption. */
  useEffect(() => {
    if (!rec.kept) return;
    setThread(rec.kept.thread || null);
    setOpen(true);
  }, [rec.kept]);

  useEffect(() => onReportFocus((messageId) => {
    setFocusId(messageId);
    setOpen(true);
  }), []);

  const close = useCallback(() => {
    setOpen(false);
    setThread(null);
    setFocusId(null);
    loadUnread();
  }, [loadUnread]);

  const stopRecording = async () => {
    const clip = await screenRecorder.finish();
    if (clip) screenRecorder.keepClip(clip);
  };

  const sendRecording = async () => {
    setSending(true);
    const clip = await screenRecorder.finish();
    if (!clip) { setSending(false); return; }
    if (!clip.target.postUrl) {
      screenRecorder.keepClip(clip);
      toast('Pick a subscriber to send the recording to', { id: 'screen-clip' });
      setSending(false);
      return;
    }
    const id = toast.loading('Sending screen recording…');
    const form = new FormData();
    form.append('durationSec', String(clip.durationSec));
    form.append('file', clip.file, clip.file.name);
    try {
      await api.post(clip.target.postUrl, form, {
        timeout: 0,
        onUploadProgress: (e) => {
          if (e.total) toast.loading(`Sending screen recording… ${Math.round((e.loaded / e.total) * 100)}%`, { id });
        },
      });
      toast.success(`Screen recording sent to ${clip.target.label || 'the report chat'}`, { id });
      setThread(clip.target.thread || null);
      setOpen(true);
      loadUnread();
    } catch (err) {
      toast.error(`${apiError(err, 'Could not send the recording')} — it is waiting in the report`, { id });
      screenRecorder.keepClip(clip);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={mode === 'platform' ? 'Subscriber reports' : 'Report a problem to Developer Support'}
        className={cn(
          'relative inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-[hsl(var(--color-muted))] hover:text-foreground',
          className,
        )}
      >
        <MessageSquareWarning className="h-[18px] w-[18px]" />
        <span className="hidden sm:inline">Report</span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#00a884] px-1 text-[10px] font-semibold text-white shadow ring-2 ring-[hsl(var(--color-card-bg))]">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {(recording || sending) && (
        <div className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-rose-500/10 pl-2.5 pr-1 ring-1 ring-rose-500/20" role="group" aria-label="Screen recording">
          <span className="relative mr-1 flex h-2.5 w-2.5 shrink-0">
            {recording && !paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />}
            <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', paused ? 'bg-amber-500' : 'bg-rose-500')} />
          </span>
          <span className="w-10 text-[13px] font-medium tabular-nums text-rose-700 dark:text-rose-300">{formatDuration(rec.elapsed)}</span>
          <button
            type="button"
            onClick={() => (paused ? screenRecorder.resume() : screenRecorder.pause())}
            disabled={!recording}
            aria-label={paused ? 'Resume recording' : 'Pause recording'}
            title={paused ? 'Resume' : 'Pause'}
            className="rounded-md p-1.5 text-rose-700 transition hover:bg-rose-500/15 disabled:opacity-40 dark:text-rose-300"
          >
            {paused ? <Play className="h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
          </button>
          <button
            type="button"
            onClick={stopRecording}
            disabled={!recording}
            aria-label="Stop recording"
            title="Stop and review in the report"
            className="rounded-md p-1.5 text-rose-700 transition hover:bg-rose-500/15 disabled:opacity-40 dark:text-rose-300"
          >
            <Square className="h-4 w-4 fill-current" />
          </button>
          <button
            type="button"
            onClick={sendRecording}
            disabled={!recording}
            aria-label="Send recording"
            title="Stop and send to the report chat"
            className="ml-0.5 inline-flex h-7 items-center gap-1.5 rounded-md bg-rose-600 px-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Send recording</span>
          </button>
        </div>
      )}

      <ReportChat open={open} onClose={close} mode={mode} onChanged={loadUnread} initialThread={thread} focusId={focusId} />
    </>
  );
}
