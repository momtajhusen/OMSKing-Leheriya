import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera, Check, CheckCheck, ClipboardList, FileText, Headset, Image as ImageIcon, Loader2, MessagesSquare, Mic, Search, Video, X,
} from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { dayLabel, messagePreview, timeLabel, isLocalApp } from '../../lib/reportChat';
import { useAuth } from '../../hooks/useAuth';
import ChatPane from './ChatPane';

const THREAD_POLL_MS = 5000;
const KIND_ICON = { image: Camera, video: Video, audio: Mic, file: FileText };
const AVATAR_TONES = ['bg-emerald-600', 'bg-sky-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-teal-600', 'bg-indigo-600'];

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function toneFor(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i += 1) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function TenantAvatar({ id, name, className }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold text-white', toneFor(id), className)}>
      {initials(name)}
    </span>
  );
}

function SupportAvatar() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--color-primary-blue))] to-[hsl(var(--color-indigo-accent))] text-white shadow-sm">
      <Headset className="h-5 w-5" />
    </span>
  );
}

function shortWhen(value) {
  if (!value) return '';
  const label = dayLabel(value);
  return label === 'Today' ? timeLabel(value) : label;
}

function MerchantEmpty() {
  const tips = [
    { icon: ImageIcon, text: 'Paste a screenshot with Ctrl+V' },
    { icon: Mic, text: 'Tap the mic to record a voice note' },
    { icon: Video, text: 'Attach a screen recording' },
  ];
  return (
    <div className="flex h-full items-center justify-center py-8">
      <div className="mx-auto max-w-xs rounded-2xl bg-white/95 p-5 text-center shadow-sm dark:bg-[#202c33]/95">
        <SupportAvatarLarge />
        <p className="mt-3 text-[15px] font-semibold">Report a problem</p>
        <p className="mt-1 text-[13px] text-foreground/60">Tell us what went wrong. Our team replies right here.</p>
        <ul className="mt-4 space-y-2 text-left">
          {tips.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5 rounded-lg bg-black/[0.03] px-3 py-2 text-[12.5px] text-foreground/75 dark:bg-white/5">
              <Icon className="h-4 w-4 shrink-0 text-[#00a884]" /> {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SupportAvatarLarge() {
  return (
    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--color-primary-blue))] to-[hsl(var(--color-indigo-accent))] text-white shadow">
      <Headset className="h-7 w-7" />
    </span>
  );
}

function PlatformEmptyThread({ name }) {
  return (
    <div className="flex h-full items-center justify-center py-8">
      <p className="rounded-xl bg-white/95 px-4 py-3 text-center text-[13px] text-foreground/70 shadow-sm dark:bg-[#202c33]/95">
        {name} has not reported anything yet. Send a message to start.
      </p>
    </div>
  );
}

function ThreadRow({ thread, active, onSelect }) {
  const last = thread.lastMessage;
  const Icon = last ? KIND_ICON[last.kind] : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(thread.tenantId)}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
        active ? 'bg-[#f0f2f5] dark:bg-[#2a3942]' : 'hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]',
      )}
    >
      <TenantAvatar id={thread.tenantId} name={thread.tenantName} className="h-12 w-12 text-sm" />
      <span className="min-w-0 flex-1 border-b border-black/5 pb-2.5 pt-0.5 dark:border-white/5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-medium">{thread.tenantName}</span>
          <span className={cn('shrink-0 text-[11.5px]', thread.unread ? 'font-semibold text-[#00a884]' : 'text-foreground/50')}>
            {shortWhen(last?.createdAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 text-[13px] text-foreground/60">
            {last?.side === 'platform' && (last.readAt ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" /> : <Check className="h-3.5 w-3.5 shrink-0" />)}
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">
              {last ? (last.side === 'tenant' && last.senderName ? `${last.senderName}: ` : '') + messagePreview(last) : 'No reports yet'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {thread.openUpdates > 0 && (
              <span title={`${thread.openUpdates} open update${thread.openUpdates === 1 ? '' : 's'}`} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold leading-5 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
                <ClipboardList className="h-3 w-3" /> {thread.openUpdates}
              </span>
            )}
            {thread.unread > 0 && (
              <span className="min-w-[20px] rounded-full bg-[#00a884] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{thread.unread}</span>
            )}
          </span>
        </span>
      </span>
    </button>
  );
}

function PlatformInbox({ onClose, onChanged, initialThread }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(initialThread || null);

  const loadThreads = useCallback(async () => {
    try {
      const { data } = await api.get('/support/threads');
      setThreads(data.data || []);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Could not load the report inbox'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
    const timer = setInterval(() => { if (!document.hidden) loadThreads(); }, THREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [loadThreads]);

  const changed = useCallback(() => {
    loadThreads();
    onChanged?.();
  }, [loadThreads, onChanged]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? threads.filter((t) => t.tenantName.toLowerCase().includes(q)) : threads;
  }, [threads, query]);
  const current = threads.find((t) => t.tenantId === selected);
  const unreadTotal = threads.reduce((sum, t) => sum + t.unread, 0);
  const showingMain = Boolean(selected);

  return (
    <div className="flex h-full min-h-0">
      <aside className={cn('flex w-full min-w-0 flex-col border-r border-black/5 bg-white dark:border-white/5 dark:bg-[#111b21] md:w-[340px] md:shrink-0', showingMain && 'hidden md:flex')}>
        <div className="flex h-[60px] shrink-0 items-center justify-between gap-2 bg-[#f0f2f5] px-4 dark:bg-[#202c33]">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-tight">Reports</p>
            <p className="text-xs text-foreground/60">{unreadTotal ? `${unreadTotal} unread from subscribers` : 'All caught up'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-foreground/70 hover:bg-black/5 dark:hover:bg-white/10 md:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-3 py-2">
          <label className="flex items-center gap-3 rounded-lg bg-[#f0f2f5] px-3 py-1.5 dark:bg-[#202c33]">
            <Search className="h-4 w-4 text-foreground/50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search subscribers"
              className="w-full bg-transparent text-sm outline-none placeholder:text-foreground/45"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[#00a884]" /></div>}
          {!loading && error && <p className="px-4 py-6 text-center text-sm text-rose-600">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-foreground/60">{query ? 'No subscriber matches this search.' : 'No subscribers yet.'}</p>
          )}
          {filtered.map((thread) => (
            <ThreadRow key={thread.tenantId} thread={thread} active={thread.tenantId === selected} onSelect={setSelected} />
          ))}
        </div>
      </aside>

      <section className={cn('min-w-0 flex-1', !showingMain && 'hidden md:block')}>
        {current ? (
          <ChatPane
            key={current.tenantId}
            listUrl={`/support/threads/${current.tenantId}/messages`}
            readUrl={`/support/threads/${current.tenantId}/read`}
            updatesUrl={`/support/threads/${current.tenantId}/updates`}
            threadKey={current.tenantId}
            mySide="platform"
            title={current.tenantName}
            subtitle={current.tenantStatus ? `Subscriber · ${current.tenantStatus}` : 'Subscriber'}
            avatar={<TenantAvatar id={current.tenantId} name={current.tenantName} className="h-10 w-10 text-sm" />}
            onBack={() => setSelected(null)}
            onClose={onClose}
            onChanged={changed}
            emptyState={<PlatformEmptyThread name={current.tenantName} />}
          />
        ) : (
          <div className="relative flex h-full flex-col items-center justify-center gap-3 border-b-[6px] border-[#00a884] bg-[#f0f2f5] px-8 text-center dark:bg-[#222e35]">
            <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-full p-2 text-foreground/70 hover:bg-black/5 dark:hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm dark:bg-[#111b21]">
              <MessagesSquare className="h-9 w-9 text-[#00a884]" />
            </span>
            <p className="text-xl font-light">Subscriber reports</p>
            <p className="max-w-sm text-sm text-foreground/60">
              Pick a subscriber to read their screenshots, videos and voice notes, and reply in the same thread.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

/** `initialThread` opens the platform inbox on that subscriber (used when a screen recording comes back to its chat). */
export default function ReportChat({ open, onClose, mode, onChanged, initialThread }) {
  const { user } = useAuth();

  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  const platform = mode === 'platform';

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center sm:p-2" role="dialog" aria-modal="true" aria-label="Report">
      <button type="button" aria-label="Close report" className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px] animate-in fade-in" onClick={onClose} />
      <div
        className={cn(
          'relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white text-foreground shadow-2xl animate-in fade-in zoom-in-95 duration-200 dark:bg-[#111b21] sm:rounded-2xl',
          platform ? 'sm:h-[min(96vh,980px)] sm:max-w-6xl' : 'sm:h-[min(95vh,920px)] sm:max-w-[520px]',
        )}
      >
        {platform ? (
          <PlatformInbox onClose={onClose} onChanged={onChanged} initialThread={initialThread} />
        ) : (
          <ChatPane
            listUrl="/support/messages"
            readUrl="/support/read"
            updatesUrl="/support/updates"
            developerUpdatesUrl={isLocalApp() && !user?.impersonating ? '/support/as-developer/updates' : undefined}
            mySide={user?.impersonating ? 'platform' : 'tenant'}
            title="Developer Support"
            subtitle="Report a problem · photos, videos, files, voice notes"
            avatar={<SupportAvatar />}
            onClose={onClose}
            onChanged={onChanged}
            emptyState={<MerchantEmpty />}
            notice="Messages here go straight to the developer support team. Everyone in your company with access can see this chat."
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
