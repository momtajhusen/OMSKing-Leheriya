import { cn } from '../../lib/utils';
import BrandLogo from '../brand/BrandLogo';

export default function PageLoader({ label = 'Loading…', fullscreen = false }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        'grid w-full place-items-center',
        fullscreen ? 'min-h-dvh bg-background' : 'min-h-[calc(100dvh-10.5rem)]'
      )}
    >
      <div className="flex flex-col items-center px-6">
        <div className="page-loader-mark">
          <svg className="page-loader-ring" viewBox="0 0 96 96" aria-hidden="true">
            <circle className="page-loader-ring-track" cx="48" cy="48" r="42" />
            <circle className="page-loader-ring-fill" cx="48" cy="48" r="42" />
          </svg>
          <BrandLogo className="relative z-[1] h-14 w-14 rounded-[18px] shadow-lg shadow-emerald-900/20" />
        </div>
        <div className="page-loader-bar" aria-hidden="true">
          <span />
        </div>
        <p className="mt-4 text-sm font-medium tracking-wide text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
