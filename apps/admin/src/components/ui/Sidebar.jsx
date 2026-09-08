import { cn } from '../../lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function Sidebar({ className, collapsed, onToggle, children, ...props }) {
  return (
    <aside
      className={cn(
        'flex flex-col border-r bg-muted/40 transition-all duration-300',
        collapsed ? 'w-16' : 'w-64',
        className
      )}
      {...props}
    >
      {children}
      <button
        onClick={onToggle}
        className="absolute bottom-4 right-2 rounded-md bg-background p-2 shadow-sm hover:bg-accent"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}

function SidebarHeader({ className, children, ...props }) {
  return (
    <div className={cn('flex h-16 items-center border-b px-4', className)} {...props}>
      {children}
    </div>
  );
}

function SidebarContent({ className, children, ...props }) {
  return (
    <div className={cn('flex-1 overflow-y-auto py-4', className)} {...props}>
      {children}
    </div>
  );
}

function SidebarFooter({ className, children, ...props }) {
  return (
    <div className={cn('border-t p-4', className)} {...props}>
      {children}
    </div>
  );
}

export { Sidebar, SidebarHeader, SidebarContent, SidebarFooter };