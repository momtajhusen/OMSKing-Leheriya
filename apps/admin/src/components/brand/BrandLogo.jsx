import { cn } from '../../lib/utils';
import logoSrc from '../../assets/brand/omsking-logo.png';

export default function BrandLogo({ className, alt = 'OMSKing', ...props }) {
  return (
    <img
      src={logoSrc}
      alt={alt}
      draggable={false}
      className={cn('h-9 w-9 rounded-[10px] object-cover shadow-sm', className)}
      {...props}
    />
  );
}
