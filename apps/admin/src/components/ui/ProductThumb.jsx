import { useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { mediaUrl } from '../account/ProfilePhoto';
import useProductImageStore, { catalogPhoto, findProductImage } from '../../lib/productImageStore';

function PreviewCard({ rect, src, name, sku }) {
  const width = 240;
  const gap = 12;
  const fitsRight = rect.right + gap + width < window.innerWidth - 8;
  const left = fitsRight ? rect.right + gap : Math.max(8, rect.left - gap - width);
  const top = Math.min(Math.max(8, rect.top - 8), window.innerHeight - 300);
  return createPortal(
    <div
      className="pointer-events-none fixed z-[80] w-60 overflow-hidden rounded-2xl border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] shadow-2xl"
      style={{ left, top }}
    >
      <img src={src} alt="" className="h-56 w-full object-cover" />
      <div className="space-y-0.5 px-3 py-2.5">
        <div className="truncate text-sm font-semibold">{name || sku || 'Product'}</div>
        {sku && name && sku !== name && <div className="truncate font-mono text-xs text-muted-foreground">{sku}</div>}
      </div>
    </div>,
    document.body,
  );
}

export default function ProductThumb({ name, src, sku, size = 'sm', className }) {
  const byKey = useProductImageStore((state) => state.byKey);
  const [preview, setPreview] = useState(null);
  const box = size === 'lg' ? 'h-16 w-16' : size === 'md' ? 'h-12 w-12' : 'h-10 w-10';
  const resolved = mediaUrl(catalogPhoto(src) || findProductImage(byKey, sku, name));
  const show = (event) => {
    if (!resolved) return;
    setPreview(event.currentTarget.getBoundingClientRect());
  };

  const frame = resolved ? (
    <img
      src={resolved}
      alt={name || ''}
      className={cn(box, 'rounded-xl object-cover bg-muted shadow-sm', className)}
    />
  ) : (
    <div
      className={cn(
        box,
        'flex items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-xs font-bold text-white shadow-sm',
        className,
      )}
      aria-label={name}
    >
      {(name || '?').charAt(0).toUpperCase()}
    </div>
  );

  return (
    <span
      className="inline-flex shrink-0"
      onMouseEnter={show}
      onMouseLeave={() => setPreview(null)}
    >
      {frame}
      {preview && resolved && (
        <PreviewCard rect={preview} src={resolved} name={name} sku={sku} />
      )}
    </span>
  );
}

export function ItemThumbs({ items, limit = 3 }) {
  const rows = (items || []).filter(Boolean);
  if (!rows.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.slice(0, limit).map((item, index) => (
        <div key={`${item.sku || item.name || item.title || 'item'}-${index}`} className="flex items-center gap-2">
          <ProductThumb name={item.name || item.title || item.sku} sku={item.sku} src={item.imageUrl || item.image} />
          <span className="whitespace-nowrap text-xs leading-none">{item.qty ? `${item.qty}× ` : ''}{item.sku || item.name || item.title}</span>
        </div>
      ))}
      {rows.length > limit && (
        <div className="text-[11px] text-muted-foreground">+{rows.length - limit} more</div>
      )}
    </div>
  );
}
