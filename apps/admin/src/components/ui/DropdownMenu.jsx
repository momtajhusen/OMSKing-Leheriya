import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

const DropdownContext = createContext({ close: () => {} });

function DropdownMenu({ trigger, children, align = 'end', className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const alignments = {
    start: 'left-0',
    end: 'right-0',
    center: 'left-1/2 -translate-x-1/2',
  };

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen((prev) => !prev)}>{trigger}</div>
      {open && (
        <DropdownContext.Provider value={{ close: () => setOpen(false) }}>
          <div
            className={cn(
              'absolute z-50 min-w-[12rem] overflow-hidden rounded-xl border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] text-popover-foreground shadow-pop',
              'top-full mt-2 p-1.5',
              alignments[align],
              className
            )}
          >
            {children}
          </div>
        </DropdownContext.Provider>
      )}
    </div>
  );
}

function DropdownMenuItem({ className, children, onClick, closeOnSelect = true, ...props }) {
  const { close } = useContext(DropdownContext);

  return (
    <button
      type="button"
      onClick={() => {
        onClick?.();
        if (closeOnSelect) close();
      }}
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors',
        'hover:bg-[hsl(var(--color-muted))] focus:bg-[hsl(var(--color-muted))]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function DropdownMenuSeparator({ className }) {
  return <div className={cn('-mx-1.5 my-1.5 h-px bg-[hsl(var(--color-border-premium))]', className)} />;
}

function DropdownMenuLabel({ className, children }) {
  return (
    <div className={cn('px-2.5 py-1.5 text-xs font-medium text-muted-foreground', className)}>
      {children}
    </div>
  );
}

export { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel };
