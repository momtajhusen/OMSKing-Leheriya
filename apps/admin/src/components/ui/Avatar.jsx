import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Avatar = forwardRef(({ className, src, alt, fallback, ...props }, ref) => {
  const getInitials = (name) => {
    if (!name) return '';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getGradient = (initials) => {
    const colors = [
      'from-blue-500 to-blue-600',
      'from-green-500 to-green-600',
      'from-purple-500 to-purple-600',
      'from-pink-500 to-pink-600',
      'from-orange-500 to-orange-600',
      'from-teal-500 to-teal-600',
    ];
    const index = initials.charCodeAt(0) % colors.length;
    return colors[index];
  };

  return (
    <div
      ref={ref}
      className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    >
      {src ? (
        <img src={src} alt={alt} className="aspect-square h-full w-full object-cover" />
      ) : (
        <div className={cn('flex h-full w-full items-center justify-center bg-gradient-to-br text-white font-medium', getGradient(fallback || 'User'))}>
          {fallback || getInitials(alt)}
        </div>
      )}
    </div>
  );
});

Avatar.displayName = 'Avatar';

export default Avatar;