import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Input = forwardRef(({ className, type = 'text', error, iconLeft, iconRight, ...props }, ref) => {
  return (
    <div>
      <div className="relative">
        {iconLeft && (
          <span className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-11 items-center justify-center text-slate-400">
            {iconLeft}
          </span>
        )}
        <input
          type={type}
          ref={ref}
          className={cn(
            'flex h-10 w-full rounded-lg border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] px-3 py-2 text-sm text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--color-primary-blue))]/20 focus-visible:ring-offset-2 focus-visible:border-[hsl(var(--color-primary-blue))] disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200',
            error && 'border-destructive focus-visible:ring-destructive/30 focus-visible:border-destructive',
            iconLeft && 'pl-11',
            iconRight && 'pr-11',
            className
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${props.id || props.name}-error` : undefined}
          {...props}
        />
        {iconRight && (
          <span className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-11 items-center justify-center text-slate-400">
            {iconRight}
          </span>
        )}
      </div>
      {error && (
        <p id={`${props.id || props.name}-error`} className="mt-1.5 text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;
