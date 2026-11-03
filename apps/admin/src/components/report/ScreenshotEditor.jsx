import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Check, Loader2, MoveUpRight, Pencil, SendHorizontal, Square, Undo2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MAX_FILE_MB } from '../../lib/reportChat';
import { drawShape, isMeaningful, markedName, MARKUP_COLORS, MARKUP_TOOLS, strokeWidth, toImagePoint } from '../../lib/screenshotMarkup';

const TOOL_ICON = { pen: Pencil, box: Square, arrow: MoveUpRight };
const COLOR_NAME = { '#ef4444': 'Red', '#f59e0b': 'Yellow', '#22c55e': 'Green', '#3b82f6': 'Blue', '#111827': 'Black', '#ffffff': 'White' };

/** Full screen above the report: mark up a staged photo, add a message and send it without leaving the report. */
export default function ScreenshotEditor({ item, initialText = '', onCancel, onApply, onSend }) {
  const canvas = useRef(null);
  const image = useRef(null);
  const draft = useRef(null);
  const messageInput = useRef(null);
  const [loads, setLoads] = useState(0);
  const ready = loads > 0;
  const [shapes, setShapes] = useState([]);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(MARKUP_COLORS[0]);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      image.current = img;
      canvas.current.width = img.naturalWidth;
      canvas.current.height = img.naturalHeight;
      setLoads((n) => n + 1);
    };
    img.onerror = () => {
      toast.error('Could not open this photo');
      cancel.current();
    };
    img.src = item.url;
  }, [item.url]);

  const paint = useCallback(() => {
    const c = canvas.current;
    if (!c || !image.current) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(image.current, 0, 0);
    shapes.forEach((shape) => drawShape(ctx, shape));
    if (draft.current && isMeaningful(draft.current)) drawShape(ctx, draft.current);
  }, [shapes]);

  /** Resizing the canvas on each load clears it, so every load repaints. */
  useEffect(() => { if (loads) paint(); }, [loads, paint]);

  /** After the chat's own composer grabs focus for the staged photo. */
  useEffect(() => {
    const t = setTimeout(() => messageInput.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  /** Capture phase so Escape closes only the editor, not the whole report. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel.current();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && e.target?.tagName !== 'INPUT') {
        e.preventDefault();
        setShapes((list) => list.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const pointOf = (e) => {
    const c = canvas.current;
    return toImagePoint(e.clientX, e.clientY, c.getBoundingClientRect(), c.width, c.height);
  };

  const onPointerDown = (e) => {
    if (!ready || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointOf(e);
    const width = strokeWidth(canvas.current.width);
    draft.current = tool === 'pen' ? { tool, color, width, points: [p] } : { tool, color, width, from: p, to: p };
    paint();
  };

  const onPointerMove = (e) => {
    const shape = draft.current;
    if (!shape) return;
    const p = pointOf(e);
    if (shape.tool === 'pen') shape.points.push(p);
    else shape.to = p;
    paint();
  };

  const onPointerUp = () => {
    const shape = draft.current;
    draft.current = null;
    if (shape && isMeaningful(shape)) setShapes((list) => [...list, shape]);
    else paint();
  };

  const exportFile = async () => {
    if (!shapes.length) return item.file;
    const type = item.file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((resolve) => canvas.current.toBlob(resolve, type, 0.92));
    if (!blob) throw new Error('Could not save the markup');
    if (blob.size > MAX_FILE_MB.image * 1024 * 1024) throw new Error(`Photo must be ${MAX_FILE_MB.image}MB or smaller`);
    return new File([blob], markedName(item.file.name, type), { type });
  };

  const finish = async (send) => {
    setBusy(true);
    try {
      const file = await exportFile();
      if (send) onSend(file, text);
      else onApply(file, text);
    } catch (err) {
      toast.error(err?.message || 'Could not save the markup');
      setBusy(false);
    }
  };

  const iconBtn = 'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40';

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#0b141a] text-white animate-in fade-in" role="dialog" aria-modal="true" aria-label="Mark up screenshot">
      <div className="flex shrink-0 items-center gap-1 px-2 py-2">
        <button type="button" onClick={onCancel} aria-label="Close editor" title="Close (Esc)" className="shrink-0 rounded-full p-2 text-white/80 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="mx-1 h-6 w-px shrink-0 bg-white/15" />
          {MARKUP_TOOLS.map((t) => {
            const Icon = TOOL_ICON[t.id];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                aria-pressed={tool === t.id}
                aria-label={t.label}
                title={t.label}
                className={cn(iconBtn, 'p-2', tool === t.id ? 'bg-white text-[#0b141a]' : 'text-white/80 hover:bg-white/10')}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
          <span className="mx-1 h-6 w-px shrink-0 bg-white/15" />
          {MARKUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`${COLOR_NAME[c] || c} pen`}
              aria-pressed={color === c}
              className={cn('mx-0.5 h-5 w-5 shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-[#0b141a] transition', color === c ? 'ring-white' : 'ring-transparent hover:ring-white/40')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1 pl-1">
          <button
            type="button"
            onClick={() => setShapes((list) => list.slice(0, -1))}
            disabled={!shapes.length || busy}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            className={cn(iconBtn, 'text-white/80 hover:bg-white/10')}
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => finish(false)}
            disabled={!ready || busy}
            title="Keep the markup and go back to the chat"
            className={cn(iconBtn, 'bg-white/10 text-white hover:bg-white/20')}
          >
            <Check className="h-4 w-4" /> Done
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-3 pb-3">
        {!ready && <Loader2 className="h-6 w-6 animate-spin text-white/60" />}
        <canvas
          ref={canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn('max-h-full max-w-full cursor-crosshair touch-none rounded-md shadow-2xl', !ready && 'hidden')}
        />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); finish(true); }}
        className="flex shrink-0 items-center gap-2 bg-[#202c33] px-3 py-2"
      >
        <input
          ref={messageInput}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a message…"
          maxLength={4000}
          className="min-w-0 flex-1 rounded-full bg-[#2a3942] px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/45"
        />
        <button
          type="submit"
          disabled={!ready || busy}
          aria-label="Send screenshot"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-md transition-transform hover:bg-[#019a79] active:scale-95 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
        </button>
      </form>
    </div>,
    document.body,
  );
}
