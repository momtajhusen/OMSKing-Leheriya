import { cn } from '../../lib/utils';

function Header({ className, children, ...props }) {
  return (
    <header
      className={cn(
        'flex h-16 items-center border-b bg-background px-6',
        className
      )}
      {...props}
    >
      {children}
    </header>
  );
}

export default Header;