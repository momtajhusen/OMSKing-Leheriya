import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { ChevronDown } from 'lucide-react';

const Select = forwardRef(({ className, children, disabled, error, ...props }, ref) => {
  return (
    <div>
      <div className="relative">
        <select
          ref={ref}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          className={cn(
            'flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-destructive focus-visible:ring-destructive',
            disabled && 'opacity-50',
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">{error}</p>}
    </div>
  );
});

Select.displayName = 'Select';

export default Select;