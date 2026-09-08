import { cn } from '../../lib/utils';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

const icons = {
  default: Info,
  destructive: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle,
};

function Alert({ variant = 'default', className, children, ...props }) {
  const Icon = icons[variant] || icons.default;

  return (
    <div
      role="alert"
      className={cn(
        'relative w-full rounded-lg border p-4',
        variant === 'default' && 'bg-background text-foreground',
        variant === 'destructive' && 'border-destructive/50 text-destructive dark:border-destructive',
        variant === 'warning' && 'border-yellow-500/50 text-yellow-900 dark:border-yellow-500 dark:text-yellow-200',
        variant === 'success' && 'border-green-500/50 text-green-900 dark:border-green-500 dark:text-green-200',
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-3">
        <Icon className="h-4 w-4 mt-0.5" />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

function AlertTitle({ className, children, ...props }) {
  return (
    <h5 className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props}>
      {children}
    </h5>
  );
}

function AlertDescription({ className, children, ...props }) {
  return (
    <div className={cn('text-sm [&_p]:leading-relaxed', className)} {...props}>
      {children}
    </div>
  );
}

export { Alert, AlertTitle, AlertDescription };