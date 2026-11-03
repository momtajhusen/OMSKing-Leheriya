import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Camera, ChevronDown, ClipboardList, Crop, FileText, Image as ImageIcon, Loader2, Mic, MonitorPlay, Paperclip, Pencil, Play, Reply, SendHorizontal,
  Trash2, X,
} from 'lucide-react';
import screenRecorder, { canCaptureScreen, canRecordScreen, captureScreenshot, claimClip } from '../../lib/screenRecorder';
import ScreenshotEditor from './ScreenshotEditor';
import api, { apiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { copyText } from '../../lib/copyText';
import {
  clipboardFiles, dayLabel, fileKind, fileSizeLabel, fileTypeLabel, formatDuration, hasGap, mergeMessages, messagePreview, pageSizeFor, recorderMime, MAX_FILE_MB,
} from '../../lib/reportChat';
import { ACTION_TOAST, CHAT_FILTERS, markSteps, matchesFilter, pickSummary } from '../../lib/reportUpdates';
import { useTaskSummaries } from '../../lib/reportSummaries';
import MessageBubble, { DeletedLabel, EventLabel, srcOf } from './MessageBubble';

const POLL_MS = 4000;
const MAX_GAP_PAGES = 5;
const MAX_STAGED = 10;
const FILTER_EMPTY = {
  pending: 'Nothing pending',
  fixed: 'Nothing fixed yet',
  developer: 'Nothing marked by the developer',
  client: 'Nothing marked by the client',
};
const MAX_RECORD_SEC = 10 * 60;
const GROUP_GAP_MS = 5 * 60 * 1000;

let tmpSeq = 0;

function isNearBottom(el) {
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 140;
}

function coarsePointer() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
}

function Lightbox({ media, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="flex justify-end gap-2 p-3">
        <a href={media.src} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20">
          Open original
        </a>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <img src={media.src} alt="Screenshot" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}

function StagedTray({ items, onRemove, onEdit }) {
  return (
    <div className="flex gap-2 overflow-x-auto px-3 pb-2 pt-3">
      {items.map((item) => (
        <div key={item.id} className={cn('group/staged relative h-20 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-black/5 shadow-sm dark:border-white/10', item.kind === 'file' ? 'w-44 bg-white dark:bg-[#233138]' : 'w-20')}>
          {item.kind === 'image' && <img src={item.url} alt="" className="h-full w-full object-cover" />}
          {item.kind === 'file' && (
            <div className="flex h-full items-center gap-2 py-2 pl-2 pr-6" title={item.file.name}>
              <span className="flex h-11 w-9 shrink-0 flex-col items-center justify-center rounded-md bg-indigo-500 text-white">
                <FileText className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="line-clamp-2 break-all text-[11.5px] font-medium leading-tight text-foreground">{item.file.name || 'Document'}</span>
                <span className="mt-0.5 block text-[10px] text-foreground/55">{fileTypeLabel(item.file.name, item.file.type)}</span>
              </span>
            </div>
          )}
          {item.kind === 'video' && (
            <>
              <video src={item.url} muted preload="metadata" className="h-full w-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/55 p-1.5"><Play className="h-3.5 w-3.5 fill-white text-white" /></span></span>
            </>
          )}
          {item.kind === 'file'
            ? <span className="absolute bottom-1 right-1.5 text-[9.5px] text-foreground/55">{fileSizeLabel(item.file.size)}</span>
            : <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-0.5 pt-3 text-[9.5px] text-white">{fileSizeLabel(item.file.size)}</span>}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label="Remove attachment"
            className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {item.kind === 'image' && (
            <button
              type="button"
              onClick={() => onEdit(item.id)}
              aria-label="Mark up"
              title="Draw on this photo"
              className="absolute left-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function RecordingBar({ elapsed, levels, onCancel, onSend }) {
  return (
    <div className="flex items-center gap-2 px-2 py-2 sm:px-3">
      <button type="button" onClick={onCancel} aria-label="Discard recording" className="rounded-full p-2.5 text-rose-500 transition-colors hover:bg-rose-500/10">
        <Trash2 className="h-5 w-5" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full bg-white px-4 py-2.5 shadow-sm dark:bg-[#2a3942]">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
        </span>
        <span className="w-11 shrink-0 text-sm tabular-nums text-foreground/80">{formatDuration(elapsed)}</span>
        <div className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden">
          {levels.map((level, i) => (
            <span key={i} className="w-[3px] shrink-0 rounded-full bg-emerald-600/80 dark:bg-emerald-400/80" style={{ height: `${Math.max(12, Math.round(level * 100))}%` }} />
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onSend}
        aria-label="Send voice message"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-md transition-transform hover:bg-[#019a79] active:scale-95"
      >
        <SendHorizontal className="h-5 w-5" />
      </button>
    </div>
  );
}

/**
 * One report conversation. `listUrl` lists (GET) and sends (POST multipart); `readUrl` marks the other side's messages read.
 * `updatesUrl` marks a message pending (POST); `${updatesUrl}/:id` changes its mark (PATCH).
 * `mySide` decides which messages count as unread for this viewer and which marks they may apply.
 * `developerUpdatesUrl` (localhost only) also gives the client chat the developer marks.
 */
export default function ChatPane({
  listUrl, readUrl, updatesUrl, developerUpdatesUrl, mySide, title, subtitle, avatar, onBack, onClose, onChanged, emptyState, notice, threadKey,
}) {
  const [messages, setMessages] = useState([]);
  const summaries = useTaskSummaries();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [staged, setStaged] = useState([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [editing, setEditing] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [unreadMarkerId, setUnreadMarkerId] = useState(null);
  const [newBelow, setNewBelow] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [recording, setRecording] = useState(null);
  const [levels, setLevels] = useState([]);
  const [filter, setFilter] = useState('all');
  const [trackNext, setTrackNext] = useState(false);

  const scroller = useRef(null);
  const input = useRef(null);
  const photoInput = useRef(null);
  const documentInput = useRef(null);
  const stick = useRef(true);
  const prepend = useRef(null);
  const dragDepth = useRef(0);
  const lastCount = useRef(0);
  const localUrls = useRef(new Set());
  const rec = useRef(null);
  const alive = useRef(true);
  const reading = useRef(false);
  const pageSize = useRef(pageSizeFor(0));
  const loaded = useRef(messages);
  loaded.current = messages;
  const olderBusy = useRef(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stick.current = true;
    setNewBelow(0);
    setShowJump(false);
  }, []);

  const markRead = useCallback(async (rows) => {
    const unread = rows.some((m) => m.side !== mySide && !m.readAt && !m.pending);
    if (!unread || reading.current || document.hidden) return;
    reading.current = true;
    try {
      await api.post(readUrl);
      changed.current?.();
    } catch {
      /* next poll retries */
    } finally {
      reading.current = false;
    }
  }, [mySide, readUrl]);

  /** First load and polls fetch one screenful of the newest messages; older ones come in as the user scrolls up. */
  const refresh = useCallback(async (initial = false) => {
    try {
      if (initial) pageSize.current = pageSizeFor(scroller.current?.clientHeight);
      const { data } = await api.get(listUrl, { params: { limit: pageSize.current } });
      if (!alive.current) return;
      let rows = data.data || [];
      let more = Boolean(data.meta?.hasMore);
      if (initial) {
        setHasMore(more);
        const firstUnread = rows.find((m) => m.side !== mySide && !m.readAt);
        setUnreadMarkerId(firstUnread?.id || null);
      }
      for (let i = 0; !initial && i < MAX_GAP_PAGES && hasGap(loaded.current, rows, more); i += 1) {
        const older = await api.get(listUrl, { params: { limit: pageSize.current, before: rows[0].id } });
        if (!alive.current) return;
        rows = [...(older.data.data || []), ...rows];
        more = Boolean(older.data.meta?.hasMore);
      }
      if (!initial && hasGap(loaded.current, rows, more)) {
        setHasMore(more);
        setMessages((prev) => mergeMessages(prev.filter((m) => m.pending), rows));
      } else {
        setMessages((prev) => mergeMessages(prev, rows));
      }
      setLoadError('');
      markRead(rows);
    } catch (err) {
      if (alive.current && initial) setLoadError(apiError(err, 'Could not load messages'));
    } finally {
      if (alive.current && initial) setLoading(false);
    }
  }, [listUrl, mySide, markRead]);

  useEffect(() => {
    alive.current = true;
    setMessages([]);
    setLoading(true);
    setLoadError('');
    setReplyTo(null);
    setUnreadMarkerId(null);
    stick.current = true;
    lastCount.current = 0;
    refresh(true);
    const timer = setInterval(() => {
      if (!document.hidden) refresh(false);
    }, POLL_MS);
    const onVisible = () => { if (!document.hidden) refresh(false); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  /** A mark from a message's dropdown; every bubble of the same update picks up the new mark. */
  const markMessage = async (m, action, asDeveloper = false) => {
    const url = asDeveloper ? developerUpdatesUrl : updatesUrl;
    try {
      let u = null;
      for (const step of markSteps(action)) {
        const { data } = step === 'track'
          ? await api.post(url, { messageId: m.id })
          : await api.patch(`${url}/${(u || m.update).id}`, { action: step });
        u = data.data;
      }
      const mark = { id: u.id, title: u.title, status: u.status, markedBy: asDeveloper ? 'platform' : mySide };
      setMessages((prev) => prev.map((row) => (row.id === m.id || row.update?.id === u.id ? { ...row, update: mark } : row)));
      const tenantReopen = !asDeveloper && action === 'reopen' && mySide === 'tenant';
      toast.success(tenantReopen ? 'Marked pending — add a voice note or photo below' : ACTION_TOAST[action] || 'Saved', { id: `mark-${u.id}` });
      refresh(false);
      changed.current?.();
      if (!asDeveloper && action === 'reopen' && mySide === 'tenant') startReply(m);
    } catch (err) {
      toast.error(apiError(err, 'Could not save'));
      refresh(false);
    }
  };

  const deleteMessage = async (m) => {
    try {
      const { data } = await api.delete(`${listUrl}/${m.id}`);
      setMessages((prev) => mergeMessages(prev, [data.data]));
      setReplyTo((cur) => (cur?.id === m.id ? null : cur));
      toast.success('Message deleted', { id: `delete-${m.id}` });
      changed.current?.();
    } catch (err) {
      toast.error(apiError(err, 'Could not delete this message'));
    }
  };

  const jumpToUpdate = (updateId) => {
    const source = messages.find((row) => !row.event && row.update?.id === updateId);
    if (source) jumpTo(source.id);
  };

  useEffect(() => {
    requestAnimationFrame(() => scrollToBottom());
  }, [filter, scrollToBottom]);

  useEffect(() => () => {
    localUrls.current.forEach((url) => URL.revokeObjectURL(url));
    localUrls.current.clear();
    const r = rec.current;
    if (r) {
      r.discard = true;
      try { r.recorder.stop(); } catch { /* already stopped */ }
    }
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prepend.current !== null) {
      el.scrollTop = el.scrollHeight - prepend.current;
      prepend.current = null;
      lastCount.current = messages.length;
      return;
    }
    const added = messages.slice(lastCount.current);
    lastCount.current = messages.length;
    if (!added.length) return;
    const mineAdded = added.some((m) => m.mine && m.pending);
    if (stick.current || mineAdded) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
    } else {
      const fromOthers = added.filter((m) => !m.mine).length;
      if (fromOthers) setNewBelow((n) => n + fromOthers);
    }
  }, [messages]);

  const loadOlder = useCallback(async () => {
    const el = scroller.current;
    const first = loaded.current.find((m) => !m.pending);
    if (!el || !first || olderBusy.current) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    try {
      const { data } = await api.get(listUrl, { params: { limit: pageSize.current, before: first.id } });
      if (!alive.current) return;
      prepend.current = el.scrollHeight - el.scrollTop;
      setHasMore(Boolean(data.meta?.hasMore));
      setMessages((prev) => mergeMessages(prev, data.data || []));
    } catch (err) {
      if (alive.current) toast.error(apiError(err, 'Could not load older messages'));
    } finally {
      olderBusy.current = false;
      if (alive.current) setLoadingOlder(false);
    }
  }, [listUrl]);

  /** A screenful of short messages (or a filter) may not fill the pane; keep paging back only until it can scroll. */
  useEffect(() => {
    const el = scroller.current;
    if (!el || loading || loadError || !hasMore || loadingOlder) return;
    if (el.scrollHeight <= el.clientHeight) loadOlder();
  }, [messages, filter, loading, loadError, hasMore, loadingOlder, loadOlder]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = isNearBottom(el);
    setShowJump(!stick.current);
    if (stick.current) setNewBelow(0);
    if (el.scrollTop < 80 && hasMore) loadOlder();
  };

  const onMediaLoad = () => {
    if (stick.current) {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  };

  const trackUrl = (url) => {
    localUrls.current.add(url);
    return url;
  };

  const stageFiles = useCallback((files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const accepted = [];
    list.forEach((file) => {
      const kind = fileKind(file) === 'audio' ? 'file' : fileKind(file);
      if (file.size > MAX_FILE_MB[kind] * 1024 * 1024) {
        toast.error(`${{ image: 'Photo', video: 'Video' }[kind] || file.name || 'File'} must be ${MAX_FILE_MB[kind]}MB or smaller`);
        return;
      }
      accepted.push({ id: `st-${(tmpSeq += 1)}`, file, kind, url: trackUrl(URL.createObjectURL(file)) });
    });
    if (!accepted.length) return accepted;
    setStaged((prev) => {
      const next = [...prev, ...accepted];
      if (next.length > MAX_STAGED) toast.error(`Up to ${MAX_STAGED} files at a time`);
      return next.slice(0, MAX_STAGED);
    });
    setTimeout(() => input.current?.focus(), 0);
    return accepted;
  }, []);

  useEffect(() => claimClip(screenRecorder, listUrl, (clip) => {
    if (clip.files) {
      const [first] = stageFiles(clip.files) || [];
      if (clip.markup && first?.kind === 'image') setEditing(first.id);
      return;
    }
    setStaged((prev) => [...prev, { id: `st-${(tmpSeq += 1)}`, file: clip.file, kind: 'video', url: trackUrl(URL.createObjectURL(clip.file)), durationSec: clip.durationSec }]);
    toast('Your screen recording is ready — add a note and send', { id: 'screen-clip' });
  }), [listUrl, stageFiles]);

  /** The share picker needs this click. The report is hidden meanwhile so the still shows the page, not the report. */
  const takeScreenshot = async (event) => {
    setAttachOpen(false);
    const dialog = event.currentTarget.closest('[role="dialog"]');
    if (dialog) dialog.style.visibility = 'hidden';
    try {
      const file = await captureScreenshot();
      const [first] = stageFiles([file]) || [];
      if (first?.kind === 'image') setEditing(first.id);
    } catch (err) {
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') toast.error(err?.message || 'Could not take a screenshot');
    } finally {
      if (dialog) dialog.style.visibility = '';
    }
  };

  /** The share picker needs this click; the report closes once the page is being recorded. */
  const startScreenRecording = async () => {
    setAttachOpen(false);
    try {
      await screenRecorder.start({ postUrl: listUrl, label: title, thread: threadKey || null });
      toast.success('Recording this page — use the controls next to Report to send it', { id: 'screen-rec' });
      onClose?.();
    } catch (err) {
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') toast.error(err?.message || 'Could not start screen recording');
    }
  };

  useEffect(() => {
    const onPaste = (event) => {
      if (event.defaultPrevented || lightbox || editing) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const files = clipboardFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      stageFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [stageFiles, lightbox, editing]);

  /** Excel and Word put a picture next to copied text; the text is what the user meant then. */
  const onInputPaste = (event) => {
    const files = clipboardFiles(event.clipboardData);
    if (!files.length || event.clipboardData.getData('text/plain')) return;
    event.preventDefault();
    stageFiles(files);
  };

  const quoteOf = (m) => (m ? {
    id: m.id,
    side: m.side,
    senderName: m.mine ? 'You' : m.senderName,
    text: messagePreview(m),
    kind: m.attachment?.kind || null,
  } : null);

  const sendOne = useCallback(async ({ body, file, kind, localUrl, durationSec, reply, track }) => {
    const tmpId = `tmp-${Date.now()}-${(tmpSeq += 1)}`;
    const payload = { body, file, kind, localUrl, durationSec, reply, track };
    setMessages((prev) => [...prev, {
      id: tmpId,
      pending: true,
      mine: true,
      side: mySide,
      text: body || '',
      attachment: file ? { kind, url: localUrl, durationSec, name: file.name, bytes: file.size, mime: file.type } : null,
      replyTo: reply,
      createdAt: new Date().toISOString(),
      progress: 0,
      payload,
    }]);
    const form = new FormData();
    if (body) form.append('text', body);
    if (reply?.id) form.append('replyTo', reply.id);
    if (durationSec) form.append('durationSec', String(durationSec));
    if (track) form.append('trackAsUpdate', 'true');
    if (file) form.append('file', file, file.name || `voice-${Date.now()}`);
    try {
      const { data } = await api.post(listUrl, form, {
        timeout: 0,
        onUploadProgress: file ? (e) => {
          if (!e.total) return;
          const progress = e.loaded / e.total;
          setMessages((prev) => prev.map((m) => (m.id === tmpId ? { ...m, progress } : m)));
        } : undefined,
      });
      if (!alive.current) return;
      setMessages((prev) => mergeMessages(prev.filter((m) => m.id !== tmpId), [data.data]));
      changed.current?.();
    } catch (err) {
      if (!alive.current) return;
      setMessages((prev) => prev.map((m) => (m.id === tmpId ? { ...m, failed: true, error: apiError(err, 'Not sent') } : m)));
    }
  }, [listUrl, mySide]);

  const retry = (message) => {
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    sendOne(message.payload);
  };

  /** `override` = { text, staged } when the markup editor sends its own message and edited photo. */
  const send = (override) => {
    const body = (override?.text ?? text).trim();
    const items = override?.staged ?? staged;
    if (!body && !items.length) return;
    const reply = quoteOf(replyTo);
    const track = trackNext && !replyTo?.update;
    if (items.length) {
      items.forEach((item, i) => {
        sendOne({
          body: i === 0 ? body : '', file: item.file, kind: item.kind, localUrl: item.url, durationSec: item.durationSec, reply: i === 0 ? reply : null, track: i === 0 && track,
        });
      });
    } else {
      sendOne({ body, reply, track });
    }
    setText('');
    setStaged([]);
    setReplyTo(null);
    setTrackNext(false);
    stick.current = true;
    requestAnimationFrame(() => input.current?.focus());
  };

  const withMarkup = (id, file) => staged.map((item) => (
    item.id === id && file !== item.file ? { ...item, file, url: trackUrl(URL.createObjectURL(file)) } : item
  ));

  const applyMarkup = (file, caption) => {
    setStaged(withMarkup(editing, file));
    setText(caption);
    setEditing(null);
  };

  const sendMarkup = (file, caption) => {
    const items = withMarkup(editing, file);
    setEditing(null);
    send({ text: caption, staged: items });
  };

  const editingItem = staged.find((item) => item.id === editing);

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      toast.error('This browser cannot record voice notes');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error('Allow microphone access to record a voice note');
      return;
    }
    const mime = recorderMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const state = { recorder, stream, chunks: [], startedAt: Date.now(), discard: false, reply: quoteOf(replyTo) };
    recorder.ondataavailable = (e) => { if (e.data?.size) state.chunks.push(e.data); };

    let ctx;
    let raf;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (now) => {
        raf = requestAnimationFrame(tick);
        if (now - last < 90) return;
        last = now;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += ((data[i] - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
        setLevels((prev) => [...prev.slice(-47), level]);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      /* level meter is cosmetic */
    }

    const timer = setInterval(() => {
      const elapsed = (Date.now() - state.startedAt) / 1000;
      setRecording((r) => (r ? { ...r, elapsed } : r));
      if (elapsed >= MAX_RECORD_SEC) stopRecording(true);
    }, 200);

    state.cleanup = () => {
      clearInterval(timer);
      if (raf) cancelAnimationFrame(raf);
      ctx?.close().catch(() => {});
      stream.getTracks().forEach((t) => t.stop());
    };
    recorder.onstop = () => {
      state.cleanup();
      rec.current = null;
      if (!alive.current) return;
      setRecording(null);
      setLevels([]);
      if (state.discard) return;
      const durationSec = Math.round(((Date.now() - state.startedAt) / 1000) * 10) / 10;
      if (durationSec < 0.6) {
        toast('Hold on — that recording was too short');
        return;
      }
      const type = (recorder.mimeType || mime || 'audio/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(state.chunks, { type });
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
      sendOne({ file, kind: 'audio', localUrl: trackUrl(URL.createObjectURL(blob)), durationSec, reply: state.reply });
      setReplyTo(null);
    };
    rec.current = state;
    recorder.start(250);
    setLevels([]);
    setRecording({ elapsed: 0 });
  };

  function stopRecording(sendIt) {
    const state = rec.current;
    if (!state) return;
    state.discard = !sendIt;
    try {
      state.recorder.stop();
    } catch {
      state.cleanup?.();
      rec.current = null;
      setRecording(null);
    }
  }

  const jumpTo = (id) => {
    const el = document.getElementById(`report-msg-${id}`);
    if (!el) {
      toast('That message is further up — scroll to load it');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600);
  };

  const copyMessage = async (m) => {
    try {
      await copyText(m.text);
      toast.success('Message copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  const startReply = (m) => {
    setReplyTo(m);
    requestAnimationFrame(() => input.current?.focus());
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      e.stopPropagation();
      setReplyTo(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !coarsePointer()) {
      e.preventDefault();
      send();
    }
  };

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const dragProps = {
    onDragEnter: (e) => {
      if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e) => {
      if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: (e) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      stageFiles(e.dataTransfer?.files);
    },
  };

  const canSend = Boolean(text.trim() || staged.length);
  const replyQuote = quoteOf(replyTo);
  const visible = filter === 'all' ? messages : messages.filter((m) => matchesFilter(m, filter));
  let prev = null;
  let lastDay = null;

  return (
    <div className="relative flex h-full min-h-0 flex-col" {...dragProps}>
      <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-black/5 bg-[#f0f2f5] px-3 dark:border-white/5 dark:bg-[#202c33]">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back" className="-ml-1 rounded-full p-2 text-foreground/70 hover:bg-black/5 dark:hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">{title}</p>
          {subtitle && <p className="truncate text-xs text-foreground/60">{subtitle}</p>}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-foreground/70 hover:bg-black/5 dark:hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {updatesUrl && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-black/5 bg-[#f0f2f5] px-3 py-2 [scrollbar-width:none] dark:border-white/5 dark:bg-[#202c33] [&::-webkit-scrollbar]:hidden">
          {CHAT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors',
                filter === f.id
                  ? 'bg-[#d9fdd3] text-[#008069] dark:bg-[#0a332c] dark:text-[#00a884]'
                  : 'bg-white text-foreground/65 hover:text-foreground dark:bg-[#111b21]',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div ref={scroller} onScroll={onScroll} className="report-wallpaper relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 sm:px-[6%]">
        {loadingOlder && (
          <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-foreground/50" /></div>
        )}
        {notice && !hasMore && !loading && messages.length > 0 && (
          <div className="mx-auto mt-3 w-fit max-w-[90%] rounded-lg bg-[#fff5c4] px-3 py-1.5 text-center text-[11.5px] text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#ffd279]">
            {notice}
          </div>
        )}
        {loading && (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#00a884]" /></div>
        )}
        {!loading && loadError && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-foreground/70">{loadError}</p>
            <button type="button" onClick={() => { setLoading(true); refresh(true); }} className="rounded-full bg-[#00a884] px-4 py-1.5 text-sm font-medium text-white">Try again</button>
          </div>
        )}
        {!loading && !loadError && messages.length === 0 && emptyState}
        {!loading && !loadError && messages.length > 0 && visible.length === 0 && (
          <p className="mx-auto mt-6 w-fit rounded-lg bg-white/90 px-3 py-1.5 text-[12.5px] text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">
            {FILTER_EMPTY[filter] || 'No messages'}
          </p>
        )}

        {visible.map((m) => {
          const day = dayLabel(m.createdAt);
          const newDay = day !== lastDay;
          lastDay = day;
          if (m.event || m.deleted) {
            prev = null;
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="sticky top-2 z-10 my-2 flex justify-center">
                    <span className="rounded-lg bg-white/95 px-3 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">{day}</span>
                  </div>
                )}
                {m.deleted
                  ? <DeletedLabel message={m} />
                  : <EventLabel message={m} highlighted={highlightId === m.id} onOpenUpdate={jumpToUpdate} />}
              </Fragment>
            );
          }
          const sameSender = prev && !newDay && prev.mine === m.mine && (prev.senderName === m.senderName || m.mine)
            && new Date(m.createdAt) - new Date(prev.createdAt) < GROUP_GAP_MS && m.id !== unreadMarkerId;
          prev = m;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="sticky top-2 z-10 my-2 flex justify-center">
                  <span className="rounded-lg bg-white/95 px-3 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">{day}</span>
                </div>
              )}
              {m.id === unreadMarkerId && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-white/90 px-4 py-1 text-xs font-medium text-[#00a884] shadow-sm dark:bg-[#182229]">Unread messages</span>
                </div>
              )}
              <MessageBubble
                message={m}
                summary={pickSummary(m.update, summaries[m.id])}
                grouped={Boolean(sameSender)}
                showName={!m.mine && !sameSender}
                highlighted={highlightId === m.id}
                onReply={startReply}
                onCopy={copyMessage}
                onJump={jumpTo}
                onOpenImage={setLightbox}
                onRetry={retry}
                onMediaLoad={onMediaLoad}
                mySide={mySide}
                onMark={updatesUrl ? markMessage : undefined}
                onDevMark={developerUpdatesUrl ? (m, action) => markMessage(m, action, true) : undefined}
                onDelete={deleteMessage}
              />
            </Fragment>
          );
        })}
      </div>

      {showJump && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          aria-label="Scroll to latest"
          className="absolute bottom-24 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white text-foreground/70 shadow-lg transition hover:text-foreground dark:bg-[#202c33]"
        >
          <ChevronDown className="h-5 w-5" />
          {newBelow > 0 && (
            <span className="absolute -top-1.5 -right-1 min-w-[20px] rounded-full bg-[#00a884] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{newBelow}</span>
          )}
        </button>
      )}

      <div className="shrink-0 border-t border-black/5 bg-[#f0f2f5] pb-[env(safe-area-inset-bottom)] dark:border-white/5 dark:bg-[#202c33]">
        {trackNext && !recording && (
          <div className="flex items-center gap-2 px-3 pt-2">
            <span className="inline-flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-amber-100 px-3 py-1.5 text-[12.5px] text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
              <ClipboardList className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {replyTo?.update ? 'This reply already joins the pending message it quotes' : 'This message will be marked pending until it is fixed'}
              </span>
            </span>
            <button type="button" onClick={() => setTrackNext(false)} aria-label="Do not track" className="rounded-full p-1.5 text-foreground/60 hover:bg-black/5 dark:hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {replyQuote && !recording && (
          <div className="flex items-center gap-2 px-3 pt-2">
            <div className={cn('flex min-w-0 flex-1 overflow-hidden rounded-lg border-l-4 bg-black/5 dark:bg-white/5', replyQuote.side === 'platform' ? 'border-sky-500' : 'border-emerald-500')}>
              <div className="min-w-0 flex-1 px-2.5 py-1.5">
                <p className={cn('flex items-center gap-1 text-xs font-semibold', replyQuote.side === 'platform' ? 'text-sky-600 dark:text-sky-400' : 'text-emerald-700 dark:text-emerald-400')}>
                  <Reply className="h-3 w-3" /> {replyQuote.senderName}
                </p>
                <p className="truncate text-[13px] text-foreground/70">{replyQuote.text}</p>
              </div>
              {replyTo?.attachment?.kind === 'image' && (
                <img src={srcOf(replyTo.attachment)} alt="" className="h-12 w-12 shrink-0 object-cover" />
              )}
            </div>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="rounded-full p-1.5 text-foreground/60 hover:bg-black/5 dark:hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {staged.length > 0 && !recording && (
          <StagedTray
            items={staged}
            onRemove={(id) => setStaged((list) => list.filter((item) => item.id !== id))}
            onEdit={setEditing}
          />
        )}

        {recording ? (
          <RecordingBar
            elapsed={recording.elapsed}
            levels={levels}
            onCancel={() => stopRecording(false)}
            onSend={() => stopRecording(true)}
          />
        ) : (
          <div className="flex items-end gap-1.5 px-2 py-2 sm:px-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setAttachOpen((o) => !o)}
                aria-label="Attach photo"
                aria-expanded={attachOpen}
                className={cn('rounded-full p-2.5 text-foreground/60 transition hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10', attachOpen && 'rotate-45 bg-black/5 dark:bg-white/10')}
              >
                <Paperclip className="h-5 w-5" />
              </button>
              {attachOpen && (
                <>
                  <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setAttachOpen(false)} />
                  <div className="absolute bottom-12 left-0 z-20 w-52 overflow-hidden rounded-2xl bg-white py-2 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-2 dark:bg-[#233138]">
                    <button type="button" onClick={() => { setAttachOpen(false); photoInput.current?.click(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm hover:bg-black/5 dark:hover:bg-white/5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500 text-white"><ImageIcon className="h-4 w-4" /></span>
                      Photos
                    </button>
                    <button type="button" onClick={() => { setAttachOpen(false); documentInput.current?.click(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm hover:bg-black/5 dark:hover:bg-white/5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-white"><FileText className="h-4 w-4" /></span>
                      Document
                    </button>
                    {canCaptureScreen() && (
                      <button type="button" onClick={takeScreenshot} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm hover:bg-black/5 dark:hover:bg-white/5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white"><Crop className="h-4 w-4" /></span>
                        Take screenshot
                      </button>
                    )}
                    {canRecordScreen() && (
                      <button
                        type="button"
                        onClick={startScreenRecording}
                        disabled={screenRecorder.getState().status !== 'idle'}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-white"><MonitorPlay className="h-4 w-4" /></span>
                        Record screen
                      </button>
                    )}
                    <p className="flex items-center gap-2 border-t border-black/5 px-4 pb-1 pt-2 text-[11px] text-foreground/50 dark:border-white/5">
                      <Camera className="h-3.5 w-3.5" /> Tip: paste a screenshot with Ctrl+V
                    </p>
                  </div>
                </>
              )}
              <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => { stageFiles(e.target.files); e.target.value = ''; }} />
              <input ref={documentInput} type="file" accept="*/*" multiple hidden onChange={(e) => { stageFiles(e.target.files); e.target.value = ''; }} />            </div>

            {updatesUrl && (
              <button
                type="button"
                onClick={() => setTrackNext((on) => !on)}
                aria-pressed={trackNext}
                aria-label="Send as pending"
                title="Send as pending"
                className={cn(
                  'rounded-full p-2.5 transition',
                  trackNext ? 'bg-amber-500 text-white shadow-sm' : 'text-foreground/60 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                )}
              >
                <ClipboardList className="h-5 w-5" />
              </button>
            )}

            <div className="flex min-w-0 flex-1 items-end rounded-3xl bg-white px-4 py-2 shadow-sm dark:bg-[#2a3942]">
              <textarea
                ref={input}
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onInputPaste}
                placeholder={staged.length ? 'Add a caption…' : trackNext ? 'Describe the problem…' : 'Type a message'}
                maxLength={4000}
                className="block max-h-[132px] min-h-[24px] w-full resize-none bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-foreground/45"
              />
            </div>

            {canSend ? (
              <button
                type="button"
                onClick={send}
                aria-label="Send"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-md transition-transform hover:bg-[#019a79] active:scale-95"
              >
                <SendHorizontal className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                aria-label="Record voice message"
                title="Record voice message"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-md transition-transform hover:bg-[#019a79] active:scale-95"
              >
                <Mic className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[#00a884]/10 p-6 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-[#00a884] bg-white/95 px-8 py-6 text-center shadow-xl dark:bg-[#202c33]/95">
            <ImageIcon className="mx-auto h-8 w-8 text-[#00a884]" />
            <p className="mt-2 text-sm font-semibold">Drop photos or videos here</p>
          </div>
        </div>
      )}

      {editingItem && (
        <ScreenshotEditor
          key={editingItem.id}
          item={editingItem}
          initialText={text}
          onCancel={() => setEditing(null)}
          onApply={applyMarkup}
          onSend={sendMarkup}
        />
      )}

      {lightbox && <Lightbox media={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}