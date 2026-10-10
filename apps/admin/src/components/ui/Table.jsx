import { cn } from '../../lib/utils';

const Table = ({ className, ...props }) => (
  <div className="relative w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
    <table className={cn('w-max min-w-full border-collapse text-sm', className)} {...props} />
  </div>
);

const TableHeader = ({ className, ...props }) => (
  <thead className={cn('[&_tr]:border-b border-[hsl(var(--color-border-premium))]', className)} {...props} />
);

const TableBody = ({ className, ...props }) => (
  <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
);

const TableFooter = ({ className, ...props }) => (
  <tfoot className={cn('border-t border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-muted))]/50 font-medium [&>tr]:last:border-b-0', className)} {...props} />
);

const TableRow = ({ className, ...props }) => (
  <tr className={cn('border-b border-[hsl(var(--color-border-premium))] transition-colors duration-200 hover:bg-[hsl(var(--color-muted))]/30 data-[state=selected]:bg-[hsl(var(--color-muted))]/50', className)} {...props} />
);

const TableHead = ({ className, ...props }) => (
  <th
    className={cn(
      'h-11 whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-muted-foreground [&:has([role=checkbox])]:pr-0',
      className
    )}
    {...props}
  />
);

const TableCell = ({ className, ...props }) => (
  <td className={cn('max-w-[10rem] whitespace-normal break-words px-3 py-2.5 align-top [&:has([role=checkbox])]:pr-0', className)} {...props} />
);

const TableCaption = ({ className, ...props }) => (
  <caption className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
);

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };