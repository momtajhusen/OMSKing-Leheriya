import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, BadgeCheck, Ban, Camera, Check, CheckCheck, ChevronDown, CircleCheck, CirclePlay, Clock, Copy, Download, FileText, Mic, Pause, Play, Reply,
  RotateCcw, RotateCw, SquareArrowOutUpRight, Trash2, Video, Wand2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import api from '../../lib/api';
import { fileSizeLabel, fileTypeLabel, formatDuration, mediaSrc, messagePreview, timeLabel } from '../../lib/reportChat';
import { eventLabel, markOptions, statusChips } from '../../lib/reportUpdates';
import { checkSteps, fixedPage } from '../../lib/taskPage';
import { ROUTE_DEFS } from '../../router';

const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;
const KIND_ICON = { image: Camera, video: Video, audio: Mic, file: FileText };

let playingAudio = null;

export function srcOf(attachment) {
  return mediaSrc(attachment?.url, api.defaults.baseURL);
}

/** A document in a bubble, WhatsApp style: type tile, name, "PDF · 1.2 MB", and a download. */
function DocumentCard({ attachment, src, mine, pending, progress }) {
  const meta = [fileTypeLabel(attachment.name, attachment.mime), attachment.bytes ? fileSizeLabel(attachment.bytes) : ''].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="flex h-10 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-500 text-white"><FileText className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{attachment.name || 'Document'}</span>
        <span className="block text-[11px] text-[#667781] dark:text-[#8696a0]">{meta}</span>
      </span>
      {!pending && <Download className="h-4 w-4 shrink-0 text-[#667781] dark:text-[#8696a0]" />}
    </>
  );
  const cls = cn('relative flex w-[240px] max-w-full items-center gap-2.5 overflow-hidden rounded-md px-2 py-2', mine ? 'bg-black/5 dark:bg-black/15' : 'bg-black/[0.04] dark:bg-white/5');
  if (pending) {
    return (
      <div className={cls}>
        {body}
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/10"><span className="block h-full bg-emerald-600 transition-all" style={{ width: `${Math.round((progress || 0) * 100)}%` }} /></span>
      </div>
    );
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" download={attachment.name || true} title={`Download ${attachment.name || 'document'}`} className={cn(cls, 'hover:bg-black/10 dark:hover:bg-white/10')}>
      {body}
    </a>
  );
}

function Linkified({ text }) {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) => (
    i % 2 === 1
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-sky-600 underline underline-offset-2 dark:text-sky-400 break-all">{part}</a>
      : <span key={i}>{part}</span>
  ));
}

function waveform(seed, count = 32) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: count }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return 0.25 + ((h >>> 16) % 1000) / 1333;
  });
}

export function VoiceNote({ id, src, duration, mine }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration || 0);
  const bars = useMemo(() => waveform(id || src || 'voice'), [id, src]);
  const progress = total ? Math.min(1, current / total) : 0;

  useEffect(() => () => {
    if (playingAudio === audio.current) playingAudio = null;
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      if (playingAudio && playingAudio !== el) playingAudio.pause();
      playingAudio = el;
      el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  };

  const seek = (event) => {
    const el = audio.current;
    if (!el || !total) return;
    const rect = event.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * total;
    setCurrent(el.currentTime);
  };

  return (
    <div className="flex w-[210px] max-w-full items-center gap-2 py-0.5">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) setTotal(e.currentTarget.duration);
        }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95',
          mine ? 'bg-emerald-700/90 text-white dark:bg-emerald-300 dark:text-emerald-950' : 'bg-[hsl(var(--color-primary-blue))] text-white',
        )}
      >
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex h-6 cursor-pointer items-center gap-[2px]" onClick={seek} role="slider" aria-valuenow={Math.round(progress * 100)} aria-label="Seek">
          {bars.map((height, i) => (
            <span
              key={i}
              className={cn(
                'w-[3px] rounded-full transition-colors',
                i / bars.length < progress
                  ? (mine ? 'bg-emerald-800 dark:bg-emerald-200' : 'bg-[hsl(var(--color-primary-blue))]')
                  : 'bg-foreground/25',
              )}
              style={{ height: `${Math.round(height * 100)}%` }}
            />
          ))}
        </div>
        <div className="mt-0.5 text-[11px] tabular-nums text-foreground/60">
          {formatDuration(playing || current ? current : total)}
        </div>
      </div>
    </div>
  );
}

function Ticks({ message }) {
  if (message.failed) return <AlertCircle className="h-3.5 w-3.5 text-rose-500" />;
  if (message.pending) return <Clock className="h-3 w-3" />;
  if (message.readAt) return <CheckCheck className="h-3.5 w-3.5 text-sky-500" />;
  return <Check className="h-3.5 w-3.5" />;
}

function Quote({ quote, mine, onJump }) {
  const Icon = KIND_ICON[quote.kind];
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onJump?.(quote.id); }}
      className={cn(
        'mb-1 flex w-full min-w-0 overflow-hidden rounded-md border-l-4 text-left',
        quote.side === 'platform' ? 'border-sky-500' : 'border-emerald-500',
        mine ? 'bg-emerald-900/10 dark:bg-black/20' : 'bg-foreground/5',
      )}
    >
      <span className="min-w-0 flex-1 px-2 py-1">
        <span className={cn('block truncate text-xs font-semibold', quote.side === 'platform' ? 'text-sky-600 dark:text-sky-400' : 'text-emerald-700 dark:text-emerald-400')}>
          {quote.senderName || 'Message'}
        </span>
        <span className="flex items-center gap-1 text-xs text-foreground/70">
          {Icon && <Icon className="h-3 w-3 shrink-0" />}
          <span className="line-clamp-2 break-words">{messagePreview(quote)}</span>
        </span>
      </span>
    </button>
  );
}

const EVENT_STYLE = {
  start: { icon: CirclePlay, tone: 'text-sky-700 dark:text-sky-300' },
  complete: { icon: CircleCheck, tone: 'text-violet-700 dark:text-violet-300' },
  confirm: { icon: BadgeCheck, tone: 'text-emerald-700 dark:text-emerald-300' },
  reopen: { icon: RotateCcw, tone: 'text-amber-700 dark:text-amber-300' },
};

const STATUS_CHIP = {
  pending: { cls: 'bg-amber-500/15 text-amber-800 dark:text-amber-300', icon: Clock },
  in_progress: { cls: 'bg-sky-500/15 text-sky-800 dark:text-sky-300', icon: CirclePlay },
  done: { cls: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300', icon: Check },
  confirmed: { cls: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300', icon: Check },
  client: { cls: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300', icon: CheckCheck },
};
const OPTION_DOT = { pending: 'bg-amber-500', progress: 'bg-sky-500', complete: 'bg-emerald-500', fixed: 'bg-emerald-500' };

/** The chevron in a message's top-right corner: set its status (developer or client marks), or delete your own message. */
function MessageMenu({ message, side, onMark, onDevMark, onDelete }) {
  const [open, setOpen] = useState(null);
  const button = useRef(null);
  const options = onMark ? markOptions(message.update?.status || null, side) : [];
  const devOptions = onDevMark ? markOptions(message.update?.status || null, 'platform') : [];
  const canDelete = Boolean(message.mine && onDelete);
  if (!options.length && !devOptions.length && !canDelete) return null;
  const sections = [
    { key: 'own', title: side === 'platform' ? 'Developer status' : 'Status', items: options, apply: onMark },
    { key: 'dev', title: 'Developer status', items: devOptions, apply: onDevMark },
  ].filter((section) => section.items.length);

  const toggle = (e) => {
    e.stopPropagation();
    if (open) { setOpen(null); return; }
    const at = button.current.getBoundingClientRect();
    const box = button.current.closest('.report-wallpaper')?.getBoundingClientRect();
    setOpen(box && box.bottom - at.bottom < 150 ? 'up' : 'down');
  };

  const remove = (e) => {
    e.stopPropagation();
    setOpen(null);
    if (window.confirm('Delete this message for everyone?')) onDelete(message);
  };

  return (
    <div className={cn('absolute right-1 top-1', open ? 'z-30' : 'z-[1]')}>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-label="Message options"
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full shadow-sm transition-opacity',
          message.mine ? 'bg-[#d9fdd3] text-[#54656f] dark:bg-[#005c4b] dark:text-[#e9edef]' : 'bg-white text-[#54656f] dark:bg-[#202c33] dark:text-[#e9edef]',
          open ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
        )}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 cursor-default" onClick={(e) => { e.stopPropagation(); setOpen(null); }} />
          <div role="menu" className={cn('absolute right-0 z-30 w-48 overflow-hidden rounded-xl bg-white py-1 shadow-xl ring-1 ring-black/5 dark:bg-[#233138]', open === 'up' ? 'bottom-7' : 'top-7')}>
            {sections.map((section, i) => (
              <div key={section.key} role="group" aria-label={section.title} className={cn(i > 0 && 'border-t border-black/5 dark:border-white/5')}>
                <p className="px-3 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-foreground/45">{section.title}</p>
                {section.items.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={o.active}
                    disabled={!o.action && !o.active}
                    onClick={(e) => { e.stopPropagation(); setOpen(null); if (o.action) section.apply(message, o.action); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-foreground hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
                  >
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', OPTION_DOT[o.id])} />
                    <span className="flex-1">{o.label}</span>
                    {o.active && <Check className="h-4 w-4 text-[#00a884]" />}
                  </button>
                ))}
              </div>
            ))}
            {canDelete && (
              <button
                type="button"
                role="menuitem"
                onClick={remove}
                className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-rose-600 hover:bg-rose-500/10 dark:text-rose-400', sections.length > 0 && 'border-t border-black/5 dark:border-white/5')}
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                Delete for everyone
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** A status mark (start / done / confirm / reopen) shown as a centred label in the chat, like WhatsApp system notes. */
export function EventLabel({ message, highlighted, onOpenUpdate }) {
  const style = EVENT_STYLE[message.event.action] || EVENT_STYLE.start;
  const Icon = style.icon;
  return (
    <div id={`report-msg-${message.id}`} className="my-1.5 flex justify-center px-2">
      <button
        type="button"
        onClick={() => onOpenUpdate?.(message.update?.id)}
        className={cn(
          'max-w-[92%] rounded-xl bg-white/95 px-3 py-1 text-center shadow-sm transition hover:bg-white dark:bg-[#182229]/95 dark:hover:bg-[#182229]',
          highlighted && 'ring-2 ring-amber-400',
        )}
      >
        <span className={cn('inline-flex items-start gap-1.5 text-[12px] font-medium leading-snug', style.tone)}>
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="text-left">{eventLabel(message.event, message.senderName, message.mine)}</span>
        </span>
        {message.event.note && <span className="mt-0.5 block text-[12px] text-foreground/65">“{message.event.note}”</span>}
        <span className="mt-0.5 block text-[10.5px] text-foreground/45">{message.createdAt ? timeLabel(message.createdAt) : ''}</span>
      </button>
    </div>
  );
}

/** What is left of a message deleted for everyone, shown like the status labels. */
export function DeletedLabel({ message }) {
  return (
    <div id={`report-msg-${message.id}`} className="my-1.5 flex justify-center px-2">
      <span className="inline-flex max-w-[92%] items-center gap-1.5 rounded-xl bg-white/95 px-3 py-1 text-[12px] italic text-foreground/55 shadow-sm dark:bg-[#182229]/95">
        <Ban className="h-3.5 w-3.5 shrink-0" />
        {message.mine ? 'You deleted this message' : 'This message was deleted'}
        <span className="not-italic text-[10.5px] text-foreground/40">{message.createdAt ? timeLabel(message.createdAt) : ''}</span>
      </span>
    </div>
  );
}

export default function MessageBubble({
  message, summary, showName, grouped, highlighted, onReply, onCopy, onJump, onOpenImage, onRetry, onMediaLoad, mySide, onMark, onDevMark,
  onDelete, onOpenPage, onAutofix,
}) {
  const { mine, attachment } = message;
  const page = onOpenPage ? fixedPage(message.update, summary, ROUTE_DEFS.admin) : null;
  const steps = onOpenPage && ['done', 'confirmed'].includes(message.update?.status)
    ? checkSteps(message.update.check || summary?.check) : [];
  const [showCheck, setShowCheck] = useState(false);
  const [dx, setDx] = useState(0);
  const touch = useRef(null);
  const src = srcOf(attachment);
  const mediaOnly = attachment?.kind === 'image' && !message.text;

  const onTouchStart = (e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchMove = (e) => {
    if (!touch.current) return;
    const moveX = e.touches[0].clientX - touch.current.x;
    const moveY = Math.abs(e.touches[0].clientY - touch.current.y);
    if (moveY > 30) { touch.current = null; setDx(0); return; }
    setDx(Math.max(0, Math.min(72, moveX)));
  };
  const onTouchEnd = () => {
    if (dx > 56 && !message.pending) onReply(message);
    touch.current = null;
    setDx(0);
  };

  return (
    <div
      id={`report-msg-${message.id}`}
      className={cn('group flex w-full', mine ? 'justify-end' : 'justify-start', grouped ? 'mt-px' : 'mt-1.5')}
    >
      <div className={cn('relative flex max-w-[82%] items-center gap-1 sm:max-w-[68%]', mine && 'flex-row-reverse')}>
        <div
          onDoubleClick={() => !message.pending && onReply(message)}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={dx ? { transform: `translateX(${dx}px)` } : undefined}
          className={cn(
            'relative min-w-[76px] rounded-lg px-1.5 pb-0.5 pt-1 text-[13.5px] leading-[1.32] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] transition-[transform,box-shadow] duration-200',
            mine
              ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]'
              : 'bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]',
            !grouped && (mine ? 'rounded-tr-sm' : 'rounded-tl-sm'),
            highlighted && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-transparent',
            message.failed && 'opacity-80',
          )}
        >
          {!message.pending && !message.failed && <MessageMenu message={message} side={mySide} onMark={onMark} onDevMark={onDevMark} onDelete={onDelete} />}

          {showName && (
            <div className={cn('mb-px flex items-center gap-1.5 px-1 text-[12px] font-semibold', (onMark || (mine && onDelete)) && 'pr-6', message.side === 'platform' ? 'text-sky-600 dark:text-sky-400' : 'text-emerald-700 dark:text-emerald-400')}>
              <span className="truncate">{message.senderName || 'Unknown'}</span>
              {message.side === 'platform' && (
                <span className="rounded bg-sky-500/15 px-1 py-px text-[9.5px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">Support</span>
              )}
            </div>
          )}

          {message.replyTo && <Quote quote={message.replyTo} mine={mine} onJump={onJump} />}

          {attachment?.kind === 'image' && (
            <button type="button" className="relative block overflow-hidden rounded-lg" onClick={() => onOpenImage({ src, kind: 'image' })}>
              <img src={src} alt="Screenshot" onLoad={onMediaLoad} className="block max-h-[220px] min-h-[64px] w-auto max-w-full min-w-[140px] bg-black/5 object-cover sm:max-w-[240px]" />
              {message.pending && <UploadVeil progress={message.progress} />}
            </button>
          )}
          {attachment?.kind === 'video' && (
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video src={src} controls={!message.pending} playsInline preload="metadata" onLoadedMetadata={onMediaLoad} className="block max-h-[220px] w-full max-w-full sm:max-w-[240px]" />
              {message.pending && <UploadVeil progress={message.progress} />}
            </div>
          )}
          {attachment?.kind === 'file' && (
            <DocumentCard attachment={attachment} src={src} mine={mine} pending={message.pending} progress={message.progress} />
          )}
          {attachment?.kind === 'audio' && (
            <div className="relative px-1">
              <VoiceNote id={message.id} src={src} duration={attachment.durationSec} mine={mine} />
              {message.pending && <span className="absolute inset-x-1 bottom-0 h-0.5 overflow-hidden rounded bg-foreground/10"><span className="block h-full bg-emerald-600 transition-all" style={{ width: `${Math.round((message.progress || 0) * 100)}%` }} /></span>}
            </div>
          )}

          <div className={cn('flex flex-wrap items-end gap-x-2 px-1', mediaOnly && 'absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-white')}>
            {message.text && (
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-0.5 [overflow-wrap:anywhere]">
                <Linkified text={message.text} />
              </p>
            )}
            <span className={cn('ml-auto flex shrink-0 items-center gap-1 pb-px pt-0.5 text-[10.5px] leading-none', mediaOnly ? 'text-white' : 'text-[#667781] dark:text-[#8696a0]')}>
              {message.createdAt ? timeLabel(message.createdAt) : ''}
              {mine && <Ticks message={message} />}
            </span>
          </div>

          {message.update && (
            <div className="mx-1 mb-0.5 mt-0.5 flex flex-wrap gap-1">
              {statusChips(message.update.status, undefined, summary).map((c) => {
                const chip = STATUS_CHIP[c.id === 'client' ? 'client' : c.status] || STATUS_CHIP.pending;
                const ChipIcon = chip.icon;
                return (
                  <span key={c.id} title={c.hint} className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-semibold', chip.cls)}>
                    <ChipIcon className="h-3 w-3" />
                    {c.label}
                  </span>
                );
              })}
              {onAutofix && message.update.status === 'in_progress' && (
                <button type="button" onClick={() => onAutofix(message)} title="Auto-fix this message" aria-label="Auto-fix this message" className="inline-flex items-center rounded-full px-1 text-[#667781] hover:text-[#00a884] dark:text-[#8696a0]">
                  <Wand2 className="h-3 w-3" />
                </button>
              )}
              {(page || steps.length > 0) && (
                <button
                  type="button"
                  onClick={() => (steps.length ? setShowCheck((v) => !v) : onOpenPage(page))}
                  title={steps.length ? 'Kaise check karein' : `Open the page this was fixed on (${page})`}
                  aria-label={steps.length ? 'How to check this fix' : 'Open the fixed page'}
                  aria-expanded={steps.length ? showCheck : undefined}
                  className="inline-flex items-center rounded-full px-1 text-[#667781] hover:text-foreground dark:text-[#8696a0]"
                >
                  <SquareArrowOutUpRight className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          {message.update && showCheck && steps.length > 0 && (
            <div className="mx-1 mb-1 rounded-md bg-black/5 px-2 py-1.5 text-[12px] dark:bg-white/5">
              <p className="mb-0.5 font-semibold">Kaise check karein</p>
              <ol className="list-decimal space-y-0.5 pl-4">
                {steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              {page && (
                <button type="button" onClick={() => onOpenPage(page)} className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#00a884] px-2.5 py-0.5 text-[11.5px] font-medium text-white hover:bg-[#008f6f]">
                  <SquareArrowOutUpRight className="h-3 w-3" /> Page kholo
                </button>
              )}
            </div>
          )}

          {message.failed && (
            <button type="button" onClick={() => onRetry(message)} className="mt-1 flex w-full items-center justify-end gap-1 px-1 text-[11.5px] font-medium text-rose-600 dark:text-rose-400">
              <RotateCw className="h-3 w-3" /> {message.error || 'Not sent'} · Tap to retry
            </button>
          )}
        </div>

        {!message.pending && (
          <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:hidden">
            <button type="button" onClick={() => onReply(message)} title="Reply" aria-label="Reply" className="rounded-full bg-background/90 p-1.5 text-muted-foreground shadow-sm ring-1 ring-black/5 hover:text-foreground">
              <Reply className="h-3.5 w-3.5" />
            </button>
            {message.text && (
              <button type="button" onClick={() => onCopy(message)} title="Copy" aria-label="Copy" className="rounded-full bg-background/90 p-1.5 text-muted-foreground shadow-sm ring-1 ring-black/5 hover:text-foreground">
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        {dx > 0 && (
          <span className="pointer-events-none absolute -left-8 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 shadow" style={{ opacity: dx / 56 }}>
            <Reply className="h-4 w-4 text-muted-foreground" />
          </span>
        )}
      </div>
    </div>
  );
}

function UploadVeil({ progress = 0 }) {
  const pct = Math.round(progress * 100);
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <span className="absolute inset-0 flex items-center justify-center bg-black/35">
      <svg viewBox="0 0 40 40" className="h-12 w-12 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
        <circle cx="20" cy="20" r={r} fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} className="transition-all" />
      </svg>
      <span className="absolute text-[10px] font-semibold text-white">{pct}%</span>
    </span>
  );
}
