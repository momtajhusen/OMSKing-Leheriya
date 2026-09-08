import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Input = forwardRef(({ className, type = 'text', error, iconLeft, iconRight, ...props }, ref) => {
  return (
    <div className="relative">
      {iconLeft && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {iconLeft}
        </div>
      )}
      <input
        type={type}
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive focus-visible:ring-destructive',
          iconLeft && 'pl-10',
          iconRight && 'pr-10',
          className
        )}
        {...props}
      />
      {iconRight && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {iconRight}
        </div>
      )}
      {error && (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;