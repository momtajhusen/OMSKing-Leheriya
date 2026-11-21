import { cn } from '../../lib/utils';

/** Thin top progress when cached data is already on screen and a refresh is running. */
export default function SoftRefresh({ show, className }) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Updating"
      className={cn('page-loader-line mb-2', className)}
    />
  );
}
