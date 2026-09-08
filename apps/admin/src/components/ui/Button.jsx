import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Button = forwardRef(({ className, variant = 'default', size = 'default', loading, disabled, ...props }, ref) => {
  const variants = {
    default: 'bg-gradient-to-r from-[hsl(var(--color-primary-blue))] to-[hsl(var(--color-indigo-accent))] text-white hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    outline: 'border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] hover:bg-[hsl(var(--color-muted))] hover:text-foreground transition-all duration-200',
    secondary: 'bg-[hsl(var(--color-muted))] text-secondary-foreground hover:bg-[hsl(var(--color-muted))]/80 transition-all duration-200',
    ghost: 'hover:bg-[hsl(var(--color-muted))] hover:text-foreground transition-all duration-200',
    link: 'text-[hsl(var(--color-primary-blue))] underline-offset-4 hover:underline',
  };

  const sizes = {
    sm: 'h-8 px-3 text-xs rounded-lg',
    default: 'h-10 px-4 py-2 rounded-lg',
    lg: 'h-12 px-8 text-lg rounded-lg',
    icon: 'h-10 w-10 rounded-lg',
  };

  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-all duration-200 ease-premium active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--color-primary-blue))]/20 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading && (
        <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {props.children}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;