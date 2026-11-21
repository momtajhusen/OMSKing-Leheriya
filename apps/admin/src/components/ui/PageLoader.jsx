import { cn } from '../../lib/utils';
import BrandLogo from '../brand/BrandLogo';

/** Compact loader for the section that is fetching — not a full-page takeover. */
export default function PageLoader({ label = 'Loading…', fullscreen = false, className }) {
  if (fullscreen) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className="grid min-h-dvh w-full place-items-center bg-background"
      >
        <div className="page-loader-shell flex flex-col items-center px-6">
          <div className="relative mb-4 grid place-items-center">
            <span className="page-loader-orbit" aria-hidden="true" />
            <BrandLogo className="relative z-[1] h-11 w-11 rounded-2xl shadow-md shadow-emerald-900/15" />
          </div>
          <div className="page-loader-line page-loader-line--compact" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium tracking-wide text-muted-foreground">{label}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        'page-loader-shell flex min-h-[9.5rem] w-full flex-col items-center justify-center gap-3 rounded-xl border border-[hsl(var(--color-border-premium))]/80 bg-[hsl(var(--color-card-bg))]/35 px-4 py-8',
        className
      )}
    >
      <div className="page-loader-line page-loader-line--compact" aria-hidden="true" />
      <p className="flex items-center gap-2 text-sm font-medium tracking-wide text-muted-foreground">
        <span className="page-loader-dot" aria-hidden="true" />
        {label}
      </p>
    </div>
  );
}
