import { cn } from '../../lib/utils';

export default function ProductThumb({ name, src, size = 'sm', className }) {
  const box = size === 'lg' ? 'h-16 w-16' : size === 'md' ? 'h-12 w-12' : 'h-10 w-10';
  if (src) {
    return (
      <img
        src={src}
        alt={name || ''}
        className={cn(box, 'rounded-xl object-cover bg-muted shadow-sm', className)}
      />
    );
  }
  const letter = (name || '?').charAt(0).toUpperCase();
  return (
    <div
      className={cn(
        box,
        'flex items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-xs font-bold text-white shadow-sm',
        className,
      )}
      aria-label={name}
    >
      {letter}
    </div>
  );
}

export function ItemThumbs({ items, limit = 3 }) {
  const rows = (items || []).filter(Boolean);
  if (!rows.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {rows.slice(0, limit).map((item, index) => (
        <div key={`${item.sku || item.name || item.title || 'item'}-${index}`} className="flex items-center gap-2">
          <ProductThumb name={item.name || item.title || item.sku} src={item.imageUrl || item.image} />
          <span className="text-xs leading-tight">{item.qty ? `${item.qty}× ` : ''}{item.sku || item.name || item.title}</span>
        </div>
      ))}
      {rows.length > limit && (
        <div className="text-[11px] text-muted-foreground">+{rows.length - limit} more</div>
      )}
    </div>
  );
}
