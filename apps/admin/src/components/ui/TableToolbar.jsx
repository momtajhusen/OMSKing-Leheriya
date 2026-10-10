import { cn } from '../../lib/utils';

export function FieldLabel({ label, children, className }) {
  return (
    <div className={cn('block min-w-0', className)}>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/** Search and Filters sit on one row above a table so every list page names both controls. */
export default function TableToolbar({ search, filters, className }) {
  return (
    <div className={cn('flex flex-col gap-2 lg:flex-row lg:items-end', className)}>
      {search && <FieldLabel label="Search" className="min-w-0 flex-1">{search}</FieldLabel>}
      {filters && <FieldLabel label="Filters" className="min-w-0 max-w-full">{filters}</FieldLabel>}
    </div>
  );
}
