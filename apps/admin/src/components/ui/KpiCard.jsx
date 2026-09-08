import { cn } from '../../lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

function KpiCard({ label, value, delta, icon: Icon, className, ...props }) {
  const getDeltaColor = (delta) => {
    if (delta > 0) return 'text-green-600 dark:text-green-400';
    if (delta < 0) return 'text-red-600 dark:text-red-400';
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
      className={cn(
        'rounded-lg border bg-card p-6 shadow-sm',
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-bold">{value}</p>
          {delta !== undefined && (
            <div className={cn('mt-2 flex items-center text-sm', getDeltaColor(delta))}>
              <DeltaIcon className="mr-1 h-4 w-4" />
              <span>{Math.abs(delta)}%</span>
              <span className="ml-1 text-muted-foreground">vs last period</span>
            </div>
          )}
        </div>
        {Icon && (
          <div className="ml-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Icon className="h-6 w-6 text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}

export default KpiCard;