import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import api from '../../lib/api';
import { playTarget, setAutoplay } from '../../lib/autofixAutoplay';
import { cn } from '../../lib/utils';
import MessageBubble from './MessageBubble';

const noop = () => {};

/** Asked when Play is pressed: fix all pending messages, or stop after a number of them is Complete. */
export default function AutoplayStartModal({
  pending, messages = [], mySide, onOpenImage, onClose,
}) {
  const [choice, setChoice] = useState('all');
  const [count, setCount] = useState('');
  const [autoAll, setAutoAll] = useState(false);
  const known = Number.isFinite(pending);
  const target = playTarget(choice === 'all' ? 'all' : count, pending);
  const [queue, setQueue] = useState(null);

  useEffect(() => {
    let live = true;
    api.get('/dev/report-autofix/queue')
      .then(({ data }) => { if (live) setQueue(data.data || []); })
      .catch(() => { if (live) setQueue([]); });
    return () => { live = false; };
  }, []);

  const picked = queue && target ? queue.slice(0, target.all ? queue.length : target.count) : [];

  const typeCount = (value) => {
    setCount(value);
    const n = Number(value);
    const over = known && /^\d+$/.test(value.trim()) && n >= pending && pending > 0;
    setAutoAll(over);
    setChoice(over ? 'all' : 'count');
  };

  const start = () => {
    if (!target) return;
    setAutoplay(true, target.all ? null : target.count);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Start pending auto-play">
      <div className="flex max-h-full w-full max-w-sm flex-col rounded-2xl bg-white p-4 text-sm shadow-xl dark:bg-[#111b21]">
        <h3 className="text-base font-semibold">Start pending auto-play</h3>
        <p className="mt-1 text-foreground/65">
          {known ? `${pending} pending message${pending === 1 ? '' : 's'}.` : 'Pending messages.'} How many should be fixed before play pauses by itself?
        </p>

        <label className={cn('mt-3 flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2', choice === 'all' && 'border-[#00a884] bg-[#d9fdd3]/50 dark:bg-[#0a332c]')}>
          <input type="radio" name="play-target" checked={choice === 'all'} onChange={() => { setChoice('all'); setAutoAll(false); }} />
          <span className="flex-1">All pending{known ? ` (${pending})` : ''}</span>
        </label>
        <label className={cn('mt-2 flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2', choice === 'count' && 'border-[#00a884] bg-[#d9fdd3]/50 dark:bg-[#0a332c]')}>
          <input type="radio" name="play-target" checked={choice === 'count'} onChange={() => setChoice('count')} />
          <span>Only</span>
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={count}
            onChange={(e) => typeCount(e.target.value)}
            onFocus={() => { if (!autoAll) setChoice('count'); }}
            placeholder="5"
            aria-label="Number of messages to complete"
            className="w-20 rounded-lg border bg-transparent px-2 py-1 tabular-nums"
          />
          <span>messages</span>
        </label>

        <p className={cn('mt-2 min-h-[1.25rem] text-xs', target ? 'text-foreground/60' : 'text-red-500')}>
          {autoAll ? `Only ${pending} pending, so All is selected.` : target ? `${target.note}. Messages left In progress do not count.` : 'Type how many messages to fix.'}
        </p>

        {target && (
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-xl bg-[#efeae2] p-2 dark:bg-[#0b141a]">
            <div className="px-1 pb-1 text-[11px] font-medium text-foreground/60">
              {queue === null ? 'Loading the messages…' : `These ${picked.length} message${picked.length === 1 ? '' : 's'} will be fixed, in this order`}
            </div>
            {picked.map((task, i) => {
              const message = messages.find((m) => m.id === task.messageId);
              return (
                <div key={task.messageId} className="mt-1">
                  <div className="px-1 text-[11px] text-foreground/55">{i + 1}.{task.area ? ` ${task.area} ·` : ''} {task.time}</div>
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
                    <div className="line-clamp-3 rounded-lg bg-white px-2 py-1 dark:bg-[#202c33]">{task.message}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10">Cancel</button>
          <button
            type="button"
            onClick={start}
            disabled={!target}
            className="inline-flex items-center gap-1 rounded-lg bg-[#00a884] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#008069] disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> Start
          </button>
        </div>
      </div>
    </div>
  );
}
