import { Info } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Shown above an input box: what is needed, in Hinglish. */
export default function InputGuide({ guide, className }) {
  return (
    <div role="note" aria-label={guide.title} className={cn('rounded-lg border border-sky-500/25 bg-sky-500/5 p-2.5 text-[12.5px] text-foreground', className)}>
      <p className="flex items-center gap-2 font-semibold">
        <Info className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
        {guide.title}
      </p>
      {guide.need && (
        <p className="mt-1.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          <span className="font-semibold">{guide.needLabel}:</span> {guide.need}
        </p>
      )}
    </div>
  );
}
