import { cn } from '../../lib/utils';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

const TONE = {
  error: {
    wrap: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100',
    Icon: AlertCircle,
  },
  success: {
    wrap: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100',
    Icon: CheckCircle,
  },
  warning: {
    wrap: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100',
    Icon: AlertTriangle,
  },
  info: {
    wrap: 'border-teal-200 bg-teal-50 text-teal-950 dark:border-teal-900/60 dark:bg-teal-950/40 dark:text-teal-100',
    Icon: Info,
  },
};

export function FormBanner({ tone = 'error', title, children }) {
  const cfg = TONE[tone] || TONE.error;
  const Icon = cfg.Icon;
  return (
    <div role="alert" className={cn('flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm', cfg.wrap)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold leading-5">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'leading-5 opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}

export function PasswordHints({ value = '' }) {
  const checks = [
    { ok: value.length >= 8, label: 'At least 8 characters' },
    { ok: /[A-Z]/.test(value), label: 'One uppercase letter' },
    { ok: /[a-z]/.test(value), label: 'One lowercase letter' },
    { ok: /[0-9]/.test(value), label: 'One number' },
  ];
  return (
    <ul className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs">
      {checks.map((item) => (
        <li key={item.label} className={cn('flex items-center gap-2', item.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
          <CheckCircle className="h-3 w-3" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
