import { cn } from '../../lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const ICON_TONES = {
  sky: 'from-sky-500 to-blue-600',
  amber: 'from-amber-400 to-orange-500',
  emerald: 'from-emerald-400 to-teal-500',
  rose: 'from-rose-400 to-pink-500',
  violet: 'from-violet-500 to-purple-600',
  blue: 'from-emerald-500 to-teal-600',
  orange: 'from-orange-400 to-red-500',
  slate: 'from-slate-500 to-slate-700',
};

function KpiCard({ label, value, delta, icon: Icon, tone = 'blue', className, onClick, ...props }) {
  const getDeltaColor = (delta) => {
    if (delta > 0) return 'text-green-500 dark:text-green-400';
    if (delta < 0) return 'text-red-500 dark:text-red-400';
    return 'text-muted-foreground';
  };

  const getDeltaIcon = (delta) => {
    if (delta > 0) return TrendingUp;
    if (delta < 0) return TrendingDown;
    return Minus;
  };

  const DeltaIcon = getDeltaIcon(delta);

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => event.key === 'Enter' && onClick() : undefined}
      className={cn(
        'premium-card p-3 relative overflow-hidden group min-w-0 w-full',
        onClick && 'cursor-pointer',
        className
      )}
      {...props}
    >
      {/* Subtle gradient background effect */}
      <div className="absolute top-0 right-0 w-24 h-24 sm:w-32 sm:h-32 bg-gradient-to-br from-[hsl(var(--color-primary-blue))]/5 to-[hsl(var(--color-indigo-accent))]/5 rounded-full blur-2xl"></div>
      
      <div className="relative flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">{label}</p>
          <p className="break-words text-lg font-bold leading-tight tracking-tight text-foreground sm:text-xl">{value}</p>
          {delta !== undefined && (
            <div className={cn('mt-2 flex items-center text-xs sm:text-sm font-medium', getDeltaColor(delta))}>
              <DeltaIcon className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
              <span>{Math.abs(delta)}%</span>
              <span className="ml-1.5 text-muted-foreground text-[10px] sm:text-xs">vs last period</span>
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', ICON_TONES[tone] || ICON_TONES.blue)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </div>
  );
}

export default KpiCard;