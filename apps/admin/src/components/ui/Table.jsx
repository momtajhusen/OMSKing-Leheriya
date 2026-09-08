import { cn } from '../../lib/utils';

const Table = ({ className, ...props }) => (
  <div className="relative w-full overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
    <table className={cn('w-full caption-bottom text-sm min-w-[600px]', className)} {...props} />
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
      'h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
      className
    )}
    {...props}
  />
);

const TableCell = ({ className, ...props }) => (
  <td className={cn('p-4 align-middle [&:has([role=checkbox])]:pr-0', className)} {...props} />
);

const TableCaption = ({ className, ...props }) => (
  <caption className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
);

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };