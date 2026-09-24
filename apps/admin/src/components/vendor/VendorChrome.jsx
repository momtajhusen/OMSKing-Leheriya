import { cn } from '../../lib/utils';

export function VendorPage({ title, subtitle, action, children }) {
  return (
    <div className="vendor-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function VendorStat({ label, value, icon: Icon, tone = 'blue' }) {
  const tones = {
    blue: 'from-emerald-600 to-teal-600',
    emerald: 'from-emerald-500 to-teal-600',
    amber: 'from-amber-500 to-orange-600',
    rose: 'from-rose-500 to-pink-600',
    slate: 'from-slate-500 to-slate-700',
  };
  return (
    <div className="premium-card overflow-hidden p-4">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md', tones[tone] || tones.blue)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold leading-none tabular-nums">{value}</div>
          <div className="mt-1 text-xs font-medium text-muted-foreground">{label}</div>
        </div>
      </div>
    </div>
  );
}

export function VendorSheet({ children }) {
  return (
    <div className="vendor-sheet">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function VendorBulkBar({ children }) {
  return (
    <div className="sticky top-0 z-10 rounded-2xl border border-emerald-200/80 bg-emerald-50/95 p-3 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/80">
      {children}
    </div>
  );
}
