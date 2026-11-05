import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Pause } from 'lucide-react';
import { autoplayTarget, elapsedLabel, setAutoplay } from '../../lib/autofixAutoplay';
import { cn } from '../../lib/utils';
import MessageBubble from './MessageBubble';

const noop = () => {};

const TONE_ICON = {
  done: <CheckCircle2 className="h-4 w-4 shrink-0 text-[#00a884]" />,
  busy: <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" />,
  error: <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />,
};

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-center dark:bg-white/[0.06]">
      <div className="text-lg font-semibold tabular-nums">{value ?? '—'}</div>
      <div className="text-[11px] text-foreground/60">{label}</div>
    </div>
  );
}

/** Shown over the chat while pending play is on: what the loop does now and what it finished. */
export default function AutoplayStatusModal({
  status, message, onOpenImage, mySide,
}) {
  const run = status?.run;
  const log = status?.log || [];
  const done = log.filter((e) => e.tone === 'done').length;
  const current = run?.running || (run?.patchFile && !run.applied) ? run : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const stepTime = run?.running ? elapsedLabel(run?.stepAt, now) : '';
  const totalTime = run?.running ? elapsedLabel(run?.startedAt, now) : '';

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Pending auto-play">
      <div className="flex max-h-full w-full max-w-md flex-col rounded-2xl bg-white p-4 text-sm shadow-xl dark:bg-[#111b21]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00a884] opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#00a884]" />
          </span>
          <h3 className="flex-1 text-base font-semibold">Pending auto-play</h3>
          <button
            type="button"
            onClick={() => setAutoplay(false)}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
          >
            <Pause className="h-3.5 w-3.5" /> Pause
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 text-foreground/80">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#00a884]" />
          <span className="min-w-0 flex-1 truncate" title={status?.phase}>{status?.phase || 'Starting…'}</span>
          {stepTime && <span className="shrink-0 tabular-nums text-xs text-foreground/60">{stepTime}</span>}
        </div>
        {totalTime && (
          <div className="mt-1 pl-6 text-[11px] text-foreground/55">
            This message: {totalTime} so far. A fix that cannot be verified is left In progress with the reason, and play moves on.
          </div>
        )}
        {current && (message || current.message) && (
          <div className="mt-2 rounded-xl border-l-4 border-[#00a884] bg-[#efeae2] px-2 py-2 dark:bg-[#0b141a]">
            <div className="px-1 pb-1 text-[11px] font-medium text-[#008069] dark:text-[#00a884]">Now working on{current.area ? ` · ${current.area}` : ''}</div>
            <div className="max-h-64 overflow-y-auto">
              {message ? (
                <MessageBubble
                  message={message}
                  showName
                  mySide={mySide}
                  onOpenImage={onOpenImage || noop}
                  onReply={noop}
                  onCopy={noop}
                  onJump={noop}
                  onRetry={noop}
                  onMediaLoad={noop}
                  onDelete={noop}
                />
              ) : (
                <div className="line-clamp-3 px-1">{current.message}</div>
              )}
            </div>
            {message?.attachment?.kind === 'audio' && (
              <p className="px-1 pt-1 text-[11px] text-foreground/60">Auto-fix cannot listen to voice notes: if the fix depends on it, it asks you for what it says.</p>
            )}
          </div>
        )}

        {run?.verification?.requirements?.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-medium text-foreground/60">
              Client points · {run.verification.pass ? 'verified' : `not met yet (check ${run.verification.attempt} of 2)`}
            </div>
            <ul className="mt-1 space-y-0.5">
              {run.verification.requirements.map((r) => (
                <li key={r.point} className="flex items-start gap-1.5 text-[12px]" title={r.evidence}>
                  {r.met ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#00a884]" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />}
                  <span className="min-w-0">{r.point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 grid grid-cols-4 gap-2">
          <Stat label="Pending left" value={status?.progress?.pending} />
          <Stat label="In progress" value={status?.progress?.progress} />
          <Stat label="Complete" value={status?.progress?.complete} />
          <Stat label="Done now" value={autoplayTarget() ? `${done} / ${autoplayTarget()}` : done} />
        </div>

        <div className="mt-3 text-xs font-medium text-foreground/60">This session</div>
        <ul className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {log.length === 0 && <li className="py-2 text-foreground/50">Nothing finished yet.</li>}
          {log.map((e) => (
            <li key={e.id} className={cn('flex items-start gap-2 rounded-lg px-2 py-1.5', e.tone === 'error' && 'bg-red-500/5')}>
              {TONE_ICON[e.tone]}
              <div className="min-w-0">
                <div className="truncate">{e.message || e.messageId}</div>
                <div className="text-[11px] text-foreground/60">{e.result}</div>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[11px] text-foreground/55">
          Each fix is tested and checked against every client point first; only a verified fix is applied and marked Complete. Anything that needs more detail is left In progress with the reason, and the next pending message starts. Pause stops after the message being fixed now.
        </p>
      </div>
    </div>
  );
}
