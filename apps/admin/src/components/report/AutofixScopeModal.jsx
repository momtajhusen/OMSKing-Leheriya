import { useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Loader2, Wand2, X } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { nearbyText } from '../../lib/autofixInputs';
import { missingInput, pasteGuide, SCOPE_LABEL } from '../../lib/autofixScope';
import { notifyAutofixChanged } from '../../lib/reportFocus';

/** Messages that cannot be cleared without the developer's input: paste it, then that message is auto-fixed first. */
export default function AutofixScopeModal({ scope, items, onClose, onRunScope, onStarted }) {
  const [left, setLeft] = useState(items);
  const label = scope ? SCOPE_LABEL[scope] : 'this message';

  const done = (messageId) => {
    const rest = left.filter((i) => i.messageId !== messageId);
    setLeft(rest);
    if (!rest.length) onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Auto-fix needs input">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white text-foreground shadow-2xl dark:bg-[#111b21]">
        <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3 dark:border-white/10">
          <Wand2 className="h-4 w-4 text-[#00a884]" />
          <p className="flex-1 text-[15px] font-semibold">Auto-fix · {label}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-foreground/60 hover:bg-black/5 dark:hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-3 text-sm">
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-semibold">These messages cannot be cleared until you give what is missing.</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Read what each message needs under <b>Clear</b>.</li>
              <li>Paste that requirement or data in its box: a link, text, a decision or the client&apos;s answer.</li>
              <li>Click <b>Save &amp; auto-fix</b>. The input is saved on the task and Auto-fix fixes that message first.</li>
            </ol>
            <p className="mt-1">Do not paste passwords or API keys here; add those in Settings.</p>
          </div>
          {left.map((item) => <PasteRow key={item.messageId} item={item} onDone={done} onStarted={onStarted} />)}
        </div>
        {onRunScope && (
          <div className="border-t border-black/5 px-4 py-3 dark:border-white/10">
            <button type="button" onClick={onRunScope} className="w-full rounded-full border border-[#00a884] px-3 py-1.5 text-[13px] font-medium text-[#008069] hover:bg-[#00a884]/10 dark:text-[#00a884]">
              Auto-fix the other {label} messages
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function PasteRow({ item, onDone, onStarted }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const around = nearbyText(item.nearby);

  const save = async () => {
    const missing = missingInput(item, text);
    if (missing) {
      setError(missing);
      toast.error(missing, { duration: 8000 });
      return;
    }
    setError('');
    setSaving(true);
    try {
      await api.post(`/dev/report-autofix/inputs/${item.messageId}`, { text, to: 'developer' });
    } catch (err) {
      setSaving(false);
      setError(apiError(err, 'Could not save the input'));
      return;
    }
    try {
      await api.post('/dev/report-autofix', { messageId: item.messageId });
      toast.success('Input saved. Auto-fix started for this message.');
      onStarted?.(item.messageId);
    } catch (err) {
      toast(`Input saved. Auto-fix did not start now (${apiError(err, 'busy')}); it fixes this message first on the next run.`, { duration: 9000 });
    }
    notifyAutofixChanged();
    setSaving(false);
    onDone(item.messageId);
  };

  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
      <p className="font-medium">{item.message}</p>
      <p className="mt-1.5 flex items-start gap-1.5">
        <span className="shrink-0 rounded bg-rose-100 px-1.5 py-px text-[11px] font-semibold uppercase text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Clear</span>
        <span>{item.unclear || 'More information is needed'}</span>
      </p>
      <p className="mt-1 text-[12px] text-foreground/65">{pasteGuide(item)}</p>
      {around && <p className="mt-1 whitespace-pre-line text-[11.5px] text-foreground/50">{around}</p>}
      {item.options?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.options.map((option) => (
            <button key={option} type="button" onClick={() => { setText(option); setError(''); }} className="rounded-full border border-black/10 px-2 py-0.5 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">{option}</button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); if (error) setError(''); }}
        rows={3}
        placeholder={`Paste here: ${item.unclear || 'the required input'}`}
        aria-invalid={Boolean(error)}
        className="mt-2 w-full rounded-md border border-black/15 bg-transparent p-2 text-sm dark:border-white/15"
      />
      {error && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600 dark:text-rose-400">{error}</p>}
      <button type="button" onClick={save} disabled={saving} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#00a884] px-3 py-1 text-[12.5px] font-medium text-white hover:bg-[#008f6f] disabled:opacity-60">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Save &amp; auto-fix
      </button>
    </div>
  );
}
