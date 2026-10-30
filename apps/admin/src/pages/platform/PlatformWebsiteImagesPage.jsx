import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  BadgeIndianRupee, Building2, CalendarCheck, CheckCircle2, CircleDashed, ClipboardPaste, Copy, ExternalLink,
  Headset, House, ImagePlus, Images, LayoutGrid, LogIn, Pencil, RefreshCw, Search, Trash2, UploadCloud,
} from 'lucide-react';
import api, { apiError } from '../../lib/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import PageLoader from '../../components/ui/PageLoader';
import { PlatformPage } from '../../components/platform/PlatformChrome';
import { mediaUrl } from '../../components/account/ProfilePhoto';
import { copyText } from '../../lib/copyText';
import { pastedImage, readClipboardImage } from '../../lib/clipboardImage';
import { IMAGE_SIZES, MARKETING_IMAGES, imagePrompt, imagesByPage } from '../../constants/marketingImages';
import useMarketingImageStore from '../../stores/marketingImageStore';
import { cn } from '../../lib/utils';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ALT_MAX = 160;
const PAGE_ICONS = {
  Home: House,
  Features: LayoutGrid,
  Pricing: BadgeIndianRupee,
  Demo: CalendarCheck,
  About: Building2,
  Contact: Headset,
  Login: LogIn,
};
const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'missing', label: 'Missing' },
  { id: 'uploaded', label: 'Uploaded' },
];

function readSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error('unreadable'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function fileSize(bytes) {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function when(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const ICON_BUTTON = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

function ImageCard({ name, row, progress, selected, onSelect, onPick, onPaste, onCopy, onAlt, onRemove }) {
  const spec = MARKETING_IMAGES[name];
  const size = IMAGE_SIZES[spec.size];
  const uploaded = Boolean(row);
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const busy = progress !== undefined;
  const src = uploaded ? mediaUrl(row.url) : '';
  const details = [
    `${size.width} × ${size.height} · ${size.label}`,
    uploaded && row.bytes ? fileSize(row.bytes) : '',
    uploaded ? `Updated ${when(row.updatedAt)}` : '',
  ].filter(Boolean).join(' · ');

  const pick = () => inputRef.current?.click();

  return (
    <article
      data-image-card={name}
      className={cn(
        'overflow-hidden rounded-2xl border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] shadow-sm transition hover:shadow-lg',
        (over || selected) && 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-background'
      )}
      onMouseEnter={() => onSelect(name)}
      onFocus={() => onSelect(name)}
      onClick={() => onSelect(name)}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) onPick(name, file);
      }}
    >
      <div
        data-image-frame={name}
        title={uploaded ? `${row.alt || spec.alt}${row.updatedByName ? ` — updated by ${row.updatedByName}` : ''}` : spec.alt}
        className="group relative aspect-[3/2] overflow-hidden bg-[hsl(var(--color-muted)/0.5)]"
      >
        {uploaded ? (
          <>
            <img src={src} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-xl" />
            <img src={src} alt={row.alt || spec.alt} className="relative h-full w-full object-contain transition duration-500 group-hover:scale-[1.02]" loading="lazy" />
          </>
        ) : (
          <button
            type="button"
            onClick={pick}
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-emerald-50/80 via-white to-lime-50/70 text-center outline-dashed outline-2 -outline-offset-[10px] outline-emerald-200 transition hover:from-emerald-100/80 dark:from-emerald-950/30 dark:via-transparent dark:to-lime-950/20 dark:outline-emerald-800"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100 dark:bg-emerald-950 dark:ring-emerald-800">
              <ImagePlus className="h-5 w-5" />
            </span>
            <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">Drop, paste (⌘V) or click to upload</span>
            <span className="text-[11px] text-muted-foreground">PNG, JPEG or WebP · up to 5 MB</span>
          </button>
        )}

        <span
          className={cn(
            'pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur',
            uploaded ? 'bg-emerald-600/90 text-white' : 'bg-amber-100/95 text-amber-800 dark:bg-amber-900/80 dark:text-amber-100'
          )}
        >
          {uploaded ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
          {uploaded ? 'Live' : 'Missing'}
        </span>

        {selected && !busy && (
          <span className="pointer-events-none absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-slate-900/75 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm backdrop-blur">
            <ClipboardPaste className="h-3 w-3" />
            ⌘V / Ctrl+V to paste
          </span>
        )}

        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 backdrop-blur-sm">
            <p className="text-sm font-semibold">Uploading… {progress}%</p>
            <div className="h-1.5 w-2/3 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-400 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>

      <div data-image-footer={name} className="flex items-center gap-2 border-t border-[hsl(var(--color-border-premium))] px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[12px] font-bold">{name}.png</p>
          <p className="truncate text-[11px] text-muted-foreground" title={spec.section}>{spec.section}</p>
          <p className="truncate text-[10px] text-muted-foreground/80">{details}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => onCopy(name)} aria-label={`Copy prompt for ${name}`} title="Copy prompt" className={ICON_BUTTON}>
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onPaste(name)} disabled={busy} aria-label={`Paste image into ${name}`} title="Paste a copied image" className={ICON_BUTTON}>
            <ClipboardPaste className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={pick} disabled={busy} aria-label={`${uploaded ? 'Replace' : 'Upload'} ${name}`} title={uploaded ? 'Replace image' : 'Upload image'} className={cn(ICON_BUTTON, 'bg-emerald-600 text-white hover:bg-emerald-500 hover:text-white')}>
            {uploaded ? <RefreshCw className="h-3.5 w-3.5" /> : <UploadCloud className="h-3.5 w-3.5" />}
          </button>
          {uploaded && (
            <>
              <button type="button" onClick={() => onAlt(name)} disabled={busy} aria-label={`Edit alt text for ${name}`} title="Edit alt text" className={ICON_BUTTON}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => onRemove(name)} disabled={busy} aria-label={`Remove ${name}`} title="Remove image" className={cn(ICON_BUTTON, 'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40')}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(name, file);
        }}
      />
    </article>
  );
}

export default function PlatformWebsiteImagesPage() {
  const [rows, setRows] = useState({});
  const [loading, setLoading] = useState(true);
  const [pageFilter, setPageFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState({});
  const [altFor, setAltFor] = useState(null);
  const [savingAlt, setSavingAlt] = useState(false);
  const [removeFor, setRemoveFor] = useState('');
  const [removing, setRemoving] = useState(false);
  const [selected, setSelected] = useState('');
  const selectedRef = useRef('');
  const uploadRef = useRef(null);
  const putPublic = useMarketingImageStore((state) => state.put);
  const removePublic = useMarketingImageStore((state) => state.remove);

  const groups = useMemo(() => imagesByPage(), []);
  const total = groups.reduce((sum, group) => sum + group.names.length, 0);
  const uploadedCount = Object.keys(rows).filter((name) => MARKETING_IMAGES[name]).length;

  useEffect(() => {
    api.get('/marketing-images/manage')
      .then(({ data }) => setRows(Object.fromEntries((data.data || []).map((row) => [row.name, row]))))
      .catch((err) => toast.error(apiError(err, 'Could not load website images')))
      .finally(() => setLoading(false));
  }, []);

  const saveRow = (row) => {
    setRows((current) => ({ ...current, [row.name]: row }));
    putPublic(row.name, { url: row.url, alt: row.alt, updatedAt: row.updatedAt });
  };

  const upload = async (name, file) => {
    if (!TYPES.includes(file.type)) {
      toast.error('Use a PNG, JPEG or WebP image');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Image must be 5MB or smaller');
      return;
    }
    const expected = IMAGE_SIZES[MARKETING_IMAGES[name].size];
    const actual = await readSize(file).catch(() => null);
    if (actual && Math.abs(actual.width / actual.height - expected.width / expected.height) > 0.03) {
      toast(`${name}: expected ${expected.label}, this file is ${actual.width} × ${actual.height}. The site will crop it to fit.`, { duration: 6000 });
    }
    const body = new FormData();
    body.append('image', file);
    setProgress((current) => ({ ...current, [name]: 0 }));
    try {
      const { data } = await api.put(`/marketing-images/${name}`, body, {
        onUploadProgress: (event) => {
          const percent = Math.min(100, Math.round((event.loaded * 100) / (event.total || file.size)));
          setProgress((current) => ({ ...current, [name]: percent }));
        },
      });
      saveRow(data.data);
      toast.success(`${name}.png is live on the website`);
    } catch (err) {
      toast.error(apiError(err, 'Could not upload the image'));
    } finally {
      setProgress((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
  };

  uploadRef.current = upload;
  selectedRef.current = selected;

  useEffect(() => {
    const onPaste = (event) => {
      if (/INPUT|TEXTAREA/.test(event.target?.tagName || '') || event.target?.isContentEditable) return;
      const file = pastedImage(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      if (!selectedRef.current) {
        toast.error('Point at an image card first, then paste');
        return;
      }
      uploadRef.current(selectedRef.current, file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const pasteFromClipboard = async (name) => {
    setSelected(name);
    try {
      const file = await readClipboardImage(name);
      if (!file) {
        toast.error('No image on the clipboard. Copy an image first.');
        return;
      }
      upload(name, file);
    } catch (err) {
      toast.error(err?.name === 'NotAllowedError' ? 'Clipboard access was blocked. Press ⌘V / Ctrl+V on the card instead.' : err.message);
    }
  };

  const copyPrompt = async (name) => {
    try {
      await copyText(imagePrompt(name));
      toast.success(`Prompt copied: ${name}.png`);
    } catch {
      toast.error('Could not copy. Open the prompt and copy it by hand.');
    }
  };

  const saveAlt = async () => {
    setSavingAlt(true);
    try {
      const { data } = await api.patch(`/marketing-images/${altFor.name}`, { alt: altFor.value.trim() });
      saveRow(data.data);
      toast.success('Alt text saved');
      setAltFor(null);
    } catch (err) {
      toast.error(apiError(err, 'Could not save the alt text'));
    } finally {
      setSavingAlt(false);
    }
  };

  const confirmRemove = async () => {
    setRemoving(true);
    try {
      await api.delete(`/marketing-images/${removeFor}`);
      setRows((current) => {
        const next = { ...current };
        delete next[removeFor];
        return next;
      });
      removePublic(removeFor);
      toast.success(`${removeFor}.png removed`);
      setRemoveFor('');
    } catch (err) {
      toast.error(apiError(err, 'Could not remove the image'));
    } finally {
      setRemoving(false);
    }
  };

  const needle = query.trim().toLowerCase();
  const visible = groups
    .filter((group) => pageFilter === 'all' || group.page === pageFilter)
    .map((group) => ({
      ...group,
      shown: group.names.filter((name) => {
        const isUp = Boolean(rows[name]);
        if (statusFilter === 'missing' && isUp) return false;
        if (statusFilter === 'uploaded' && !isUp) return false;
        if (!needle) return true;
        return name.includes(needle) || MARKETING_IMAGES[name].section.toLowerCase().includes(needle);
      }),
    }))
    .filter((group) => group.shown.length);

  if (loading) return <PageLoader label="Loading website images…" />;

  const percent = total ? Math.round((uploadedCount / total) * 100) : 0;

  return (
    <PlatformPage
      title="Website images"
      subtitle="Photos for the public OMSKing website. Every slot shows where it appears, the exact size, and a ChatGPT prompt. An upload goes live on the site straight away."
      action={(
        <a href="/" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] px-4 text-sm font-medium transition hover:bg-muted">
          <ExternalLink className="h-4 w-4" />
          Open website
        </a>
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="premium-card p-5 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30">
                <Images className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Images live on the website</p>
                <p className="text-2xl font-bold">{uploadedCount} <span className="text-base font-medium text-muted-foreground">of {total}</span></p>
              </div>
            </div>
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{percent}%</span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-400 transition-all duration-500" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <div className="premium-card flex items-center gap-3 p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30">
            <CircleDashed className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Still missing</p>
            <p className="text-2xl font-bold">{total - uploadedCount}</p>
          </div>
        </div>
        <div className="premium-card flex items-center gap-3 p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-500 text-white shadow-md shadow-sky-500/30">
            <LayoutGrid className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Public pages</p>
            <p className="text-2xl font-bold">{groups.length}</p>
          </div>
        </div>
      </div>

      <div className="premium-card space-y-3 p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by page">
          {[{ page: 'all', names: groups.flatMap((group) => group.names) }, ...groups].map((group) => {
            const done = group.names.filter((name) => rows[name]).length;
            const Icon = group.page === 'all' ? Images : PAGE_ICONS[group.page];
            const active = pageFilter === group.page;
            return (
              <button
                key={group.page}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPageFilter(group.page)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                  active
                    ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
                    : 'border-[hsl(var(--color-border-premium))] hover:bg-muted'
                )}
              >
                <Icon className="h-4 w-4" />
                {group.page === 'all' ? 'All pages' : group.page}
                <span className={cn('rounded-full px-1.5 text-[11px] font-semibold', active ? 'bg-white/20' : 'bg-muted text-muted-foreground')}>
                  {done}/{group.names.length}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg bg-muted p-1">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatusFilter(item.id)}
                aria-pressed={statusFilter === item.id}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  statusFilter === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or section"
              aria-label="Search website images"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
        <ClipboardPaste className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <span className="font-semibold">Paste to upload:</span> copy an image (in ChatGPT, right-click the image → Copy image), point at a card and press{' '}
          <kbd className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 font-mono text-[11px] dark:border-emerald-800 dark:bg-emerald-950">⌘V</kbd> /{' '}
          <kbd className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 font-mono text-[11px] dark:border-emerald-800 dark:bg-emerald-950">Ctrl+V</kbd>.
          You can also drop a file on a card or use the paste button.
        </p>
      </div>

      {visible.length === 0 && (
        <div className="premium-card flex flex-col items-center gap-2 p-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          <p className="font-semibold">Nothing matches this filter</p>
          <p className="text-sm text-muted-foreground">Try another page or clear the search.</p>
        </div>
      )}

      {visible.map((group) => {
        const Icon = PAGE_ICONS[group.page];
        const done = group.names.filter((name) => rows[name]).length;
        return (
          <section key={group.page} className="space-y-3" aria-labelledby={`images-${group.page}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <h2 id={`images-${group.page}`} className="text-lg font-bold">{group.page} page</h2>
                  <p className="text-xs text-muted-foreground">{done} of {group.names.length} images live</p>
                </div>
              </div>
              <a href={group.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                View page
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.shown.map((name) => (
                <ImageCard
                  key={name}
                  name={name}
                  row={rows[name]}
                  progress={progress[name]}
                  selected={selected === name}
                  onSelect={setSelected}
                  onPick={upload}
                  onPaste={pasteFromClipboard}
                  onCopy={copyPrompt}
                  onAlt={(target) => setAltFor({ name: target, value: rows[target]?.alt || '' })}
                  onRemove={setRemoveFor}
                />
              ))}
            </div>
          </section>
        );
      })}

      <Modal
        open={Boolean(altFor)}
        onOpenChange={(open) => !open && setAltFor(null)}
        title="Alt text"
        description={altFor ? `Read by screen readers and search engines for ${altFor.name}.png. Leave empty to use the default.` : ''}
        footer={(
          <>
            <Button variant="outline" onClick={() => setAltFor(null)}>Cancel</Button>
            <Button onClick={saveAlt} loading={savingAlt}>Save alt text</Button>
          </>
        )}
      >
        {altFor && (
          <div className="space-y-1.5">
            <Input
              value={altFor.value}
              maxLength={ALT_MAX}
              onChange={(event) => setAltFor({ ...altFor, value: event.target.value })}
              placeholder={MARKETING_IMAGES[altFor.name].alt}
              aria-label="Alt text"
            />
            <p className="text-right text-[11px] text-muted-foreground">{altFor.value.length}/{ALT_MAX}</p>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(removeFor)}
        onOpenChange={(open) => !open && setRemoveFor('')}
        title="Remove this image?"
        description={`${removeFor}.png comes off the website. The slot shows a soft green placeholder until you upload a new one.`}
        footer={(
          <>
            <Button variant="outline" onClick={() => setRemoveFor('')}>Cancel</Button>
            <Button variant="destructive" onClick={confirmRemove} loading={removing}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Remove
            </Button>
          </>
        )}
      >
        {removeFor && rows[removeFor] && (
          <img src={mediaUrl(rows[removeFor].url)} alt="" className="max-h-56 w-full rounded-lg object-contain" />
        )}
      </Modal>
    </PlatformPage>
  );
}
