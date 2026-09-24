import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import BrandLogo from '../brand/BrandLogo';

export default function BrandMark({ className, markClassName, wordmarkClassName }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2.5', className)}>
      <BrandLogo className={cn('h-9 w-9', markClassName)} />
      <span className={cn('text-[17px] font-bold tracking-tight text-slate-900', wordmarkClassName)}>
        OMS<span className="text-emerald-600">King</span>
      </span>
    </Link>
  );
}
