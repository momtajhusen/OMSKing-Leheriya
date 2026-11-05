import { useMemo, useState } from 'react';
import {
  AlertCircle, Ban, CircleCheck, CirclePlay, Clock, LayoutList, Loader2, MessageSquare, Reply, SendHorizontal, SquareArrowOutUpRight, Table2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { cn } from '../../lib/utils';
import { dayLabel, isLocalApp, timeLabel } from '../../lib/reportChat';
import { inputGuide } from '../../lib/inputGuide';
import { notifyAutofixChanged } from '../../lib/reportFocus';
import { ITEM_STATUSES, countItems, filterItems, historyEntries, updateItems } from '../../lib/reportTabs';
import InputGuide from './InputGuide';

const TONE = {
  pending: { cls: 'bg-amber-500/10 text-amber-800 ring-amber-500/30 dark:text-amber-200', icon: Clock },
  progress: { cls: 'bg-sky-500/10 text-sky-800 ring-sky-500/30 dark:text-sky-200', icon: CirclePlay },
  waiting: { cls: 'bg-violet-500/10 text-violet-800 ring-violet-500/30 dark:text-violet-200', icon: Reply },
  input: { cls: 'bg-orange-500/10 text-orange-800 ring-orange-500/30 dark:text-orange-200', icon: AlertCircle },
  blocked: { cls: 'bg-rose-500/10 text-rose-800 ring-rose-500/30 dark:text-rose-200', icon: Ban },
  complete: { cls: 'bg-emerald-500/10 text-emerald-800 ring-emerald-500/30 dark:text-emerald-200', icon: CircleCheck },
};

function when(value) {
  return value ? `${dayLabel(value)} · ${timeLabel(value)}` : '';
}

function StatusBadge({ item }) {
  const tone = TONE[item.status] || TONE.pending;
  const Icon = tone.icon;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1', tone.cls)}>
      <Icon className="h-3 w-3" /> {item.label}
    </span>
  );
}

/**
 * What the client answered (or the requirement they gave) for this item. On localhost it is saved on the task and
 * Auto-fix starts it (and checks the fix); elsewhere it is sent as a reply to the item's message.
 */
function AnswerForm({ item, onAnswer }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const local = isLocalApp();
  const guide = inputGuide({ kind: item.status === 'waiting' ? 'waiting' : 'unclear', unclear: item.reason, needHi: item.reasonHi });

  const reply = (body) => {
    onAnswer(item.message, body);
    toast.success(guide.replied);
  };

  const submit = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    if (!local) {
      reply(body);
      setText('');
      return;
    }
    setSending(true);
    try {
      await api.post(`/dev/report-autofix/inputs/${item.id}`, { text: body, to: 'developer' });
    } catch {
      reply(body);
      setText('');
      setSending(false);
      return;
    }
    try {
      await api.post('/dev/report-autofix', { messageId: item.id });
      toast.success(guide.started, { duration: 8000 });
    } catch {
      toast(guide.queued, { duration: 9000 });
    }
    notifyAutofixChanged();
    setText('');
    setSending(false);
  };

  return (
    <form onSubmit={submit} className="mt-2 space-y-1.5">
      <InputGuide guide={guide} />
      <div className="flex items-end gap-1.5">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}
          placeholder={guide.placeholder}
          aria-label={`Client answer for ${item.title}`}
          maxLength={4000}
          className="min-w-0 flex-1 resize-y rounded-md bg-white px-2 py-1.5 text-[13px] outline-none ring-1 ring-black/10 placeholder:text-foreground/45 focus:ring-[#00a884] dark:bg-[#2a3942] dark:ring-white/10"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="inline-flex items-center gap-1 rounded-full bg-[#00a884] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />} {guide.submit}
        </button>
      </div>
    </form>
  );
}

function OpenButton({ id, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-[#008069] hover:bg-[#00a884]/10 dark:text-[#00a884]"
    >
      <SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open in chat
    </button>
  );
}

function ItemCard({ item, onOpen, onAnswer }) {
  const text = item.message.text && item.message.text !== item.title ? item.message.text : '';
  return (
    <li className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5 dark:bg-[#202c33] dark:ring-white/5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge item={item} />
        <span className="text-[11.5px] text-foreground/55">{when(item.at)}</span>
        {item.replies > 0 && <span className="text-[11.5px] text-foreground/55">· {item.replies} more message{item.replies === 1 ? '' : 's'}</span>}
        <span className="ml-auto"><OpenButton id={item.id} onOpen={onOpen} /></span>
      </div>
      <p className="mt-1.5 break-words text-[14px] font-medium [overflow-wrap:anywhere]">{item.title}</p>
      {text && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[12.5px] text-foreground/65 [overflow-wrap:anywhere]">{text}</p>}
      {item.status === 'complete' && (item.summary?.issue || item.summary?.fix) && (
        <div className="mt-1.5 space-y-0.5 text-[12px] text-foreground/70">
          {item.summary.issue && <p><span className="font-semibold">Issue:</span> {item.summary.issue}</p>}
          {item.summary.fix && <p><span className="font-semibold">Fixed:</span> {item.summary.fix}</p>}
        </div>
      )}
      {item.status !== 'complete' && !item.needsClient && item.reason && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-snug text-foreground/70 [overflow-wrap:anywhere]">
          <span className="font-semibold">Why:</span> {item.reason}
        </p>
      )}
      {item.needsClient && <AnswerForm item={item} onAnswer={onAnswer} />}
    </li>
  );
}

function ItemTable({ items, onOpen, onAnswer }) {
  const [answering, setAnswering] = useState(null);
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-[#202c33] dark:ring-white/5">
      <table className="w-full min-w-[860px] text-left text-[12.5px]">
        <thead className="bg-black/[0.03] text-[11.5px] uppercase tracking-wide text-foreground/55 dark:bg-white/5">
          <tr>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Update</th>
            <th className="px-3 py-2 font-semibold">Why / result</th>
            <th className="px-3 py-2 font-semibold">Date</th>
            <th className="px-3 py-2 font-semibold"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const detail = item.status === 'complete' ? item.summary?.fix || '' : item.reason;
            return [
              <tr key={item.key} className="border-t border-black/5 align-top dark:border-white/5">
                <td className="px-3 py-2"><StatusBadge item={item} /></td>
                <td className="min-w-[200px] max-w-[280px] break-words px-3 py-2 font-medium"><span className="line-clamp-3" title={item.title}>{item.title}</span></td>
                <td className="min-w-[240px] max-w-[340px] break-words px-3 py-2 text-foreground/70"><span className="line-clamp-4" title={detail}>{detail}</span></td>
                <td className="whitespace-nowrap px-3 py-2 text-foreground/60">{when(item.at)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {item.needsClient && (
                    <button
                      type="button"
                      onClick={() => setAnswering((cur) => (cur === item.key ? null : item.key))}
                      aria-expanded={answering === item.key}
                      className="mr-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
                    >
                      <Reply className="h-3.5 w-3.5" /> Answer
                    </button>
                  )}
                  <OpenButton id={item.id} onOpen={onOpen} />
                </td>
              </tr>,
              answering === item.key && (
                <tr key={`${item.key}-answer`} className="bg-violet-500/[0.03]">
                  <td colSpan={5} className="px-3 pb-3">
                    <div className="sticky left-3 max-w-[min(440px,calc(100vw-3rem))]"><AnswerForm item={item} onAnswer={onAnswer} /></div>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function HistoryList({ entries, onOpen }) {
  if (!entries.length) return <p className="mt-8 text-center text-sm text-foreground/60">No updates have been sent yet.</p>;
  return (
    <ol className="relative ml-2 space-y-2 border-l border-black/10 pl-4 dark:border-white/10">
      {entries.map((e) => {
        const Icon = e.kind === 'status' ? (e.action === 'complete' || e.action === 'confirm' ? CircleCheck : CirclePlay) : MessageSquare;
        return (
          <li key={e.id} className="relative rounded-lg bg-white p-2.5 shadow-sm ring-1 ring-black/5 dark:bg-[#202c33] dark:ring-white/5">
            <span className={cn(
              'absolute -left-[27px] top-3 flex h-5 w-5 items-center justify-center rounded-full text-white',
              e.kind === 'status' ? 'bg-[#00a884]' : e.side === 'platform' ? 'bg-sky-600' : 'bg-violet-600',
            )}
            >
              <Icon className="h-3 w-3" />
            </span>
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-foreground/55">
              <span>{when(e.at)}</span>
              {e.kind === 'message' && <span>· {e.who || (e.side === 'platform' ? 'Developer' : 'Client')}</span>}
              <span className="ml-auto"><OpenButton id={e.target} onOpen={onOpen} /></span>
            </div>
            <p className={cn('mt-0.5 whitespace-pre-wrap break-words text-[13px] [overflow-wrap:anywhere]', e.kind === 'status' && 'font-medium')}>{e.text}</p>
            {e.about && (
              <p className="mt-1 truncate border-l-2 border-black/15 pl-2 text-[12px] text-foreground/55 dark:border-white/20">Re: {e.about}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The Updates and History tabs of a report chat; `messages` are the chat rows (older pages load while a tab is open). */
export default function ReportUpdatesView({ tab, messages, reasons, summaries, loadingMore, onOpen, onAnswer }) {
  const [status, setStatus] = useState('all');
  const [view, setView] = useState('cards');
  const items = useMemo(() => updateItems(messages, reasons, summaries), [messages, reasons, summaries]);
  const counts = useMemo(() => countItems(items), [items]);
  const shown = filterItems(items, status);
  const entries = useMemo(() => (tab === 'history' ? historyEntries(messages) : []), [tab, messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#efeae2] dark:bg-[#0b141a]">
      {tab === 'updates' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-black/5 bg-[#f0f2f5] px-3 py-2 dark:border-white/5 dark:bg-[#202c33]">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {ITEM_STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatus(s.id)}
                aria-pressed={status === s.id}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors',
                  status === s.id
                    ? 'bg-[#d9fdd3] text-[#008069] dark:bg-[#0a332c] dark:text-[#00a884]'
                    : 'bg-white text-foreground/65 hover:text-foreground dark:bg-[#111b21]',
                )}
              >
                {s.label}
                <span className="ml-1 tabular-nums opacity-70">{counts[s.id]}</span>
              </button>
            ))}
          </div>
          <div className="flex shrink-0 rounded-full bg-white p-0.5 dark:bg-[#111b21]">
            <button
              type="button"
              onClick={() => setView('cards')}
              aria-label="Cards view"
              aria-pressed={view === 'cards'}
              title="Cards"
              className={cn('rounded-full p-1.5', view === 'cards' ? 'bg-[#d9fdd3] text-[#008069] dark:bg-[#0a332c] dark:text-[#00a884]' : 'text-foreground/55')}
            >
              <LayoutList className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              aria-label="Table view"
              aria-pressed={view === 'table'}
              title="Table"
              className={cn('rounded-full p-1.5', view === 'table' ? 'bg-[#d9fdd3] text-[#008069] dark:bg-[#0a332c] dark:text-[#00a884]' : 'text-foreground/55')}
            >
              <Table2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-[4%]">
        {loadingMore && (
          <p className="mb-2 flex items-center justify-center gap-2 text-[12px] text-foreground/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading older messages…
          </p>
        )}
        {tab === 'updates' && (
          shown.length === 0
            ? <p className="mt-8 text-center text-sm text-foreground/60">{status === 'all' ? 'No updates yet.' : `No ${ITEM_STATUSES.find((s) => s.id === status)?.label} updates.`}</p>
            : view === 'table'
              ? <ItemTable items={shown} onOpen={onOpen} onAnswer={onAnswer} />
              : <ul className="space-y-2">{shown.map((item) => <ItemCard key={item.key} item={item} onOpen={onOpen} onAnswer={onAnswer} />)}</ul>
        )}
        {tab === 'history' && <HistoryList entries={entries} onOpen={onOpen} />}
      </div>
    </div>
  );
}
