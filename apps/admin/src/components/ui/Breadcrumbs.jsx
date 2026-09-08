import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Link } from 'react-router-dom';

function Breadcrumbs({ items, className }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center space-x-1 text-sm', className)}>
      {items.map((item, index) => (
        <div key={index} className="flex items-center">
          {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          {item.href ? (
            <Link
              to={item.href}
              className={cn(
                'transition-colors hover:text-foreground',
                index === items.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'
              )}
            >
              {item.label}
            </Link>
          ) : (
            <span
              className={cn(
                index === items.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'
              )}
            >
              {item.label}
            </span>
          )}
        </div>
      ))}
    </nav>
  );
}

export default Breadcrumbs;