import { cn } from '../../lib/utils';
import { X } from 'lucide-react';

function Tag({ className, children, onClose, ...props }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs font-medium',
        className
      )}
      {...props}
    >
      {children}
      {onClose && (
        <button
          onClick={onClose}
          className="ml-1 rounded-sm hover:bg-muted-foreground/20 p-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export default Tag;