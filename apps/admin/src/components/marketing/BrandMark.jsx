import { Crown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

export default function BrandMark({ className, markClassName }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2.5', className)}>
      <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-blue-700 text-white', markClassName)}>
        <Crown className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <span className="text-[17px] font-bold tracking-tight text-slate-900">
        OMS<span className="text-blue-700">King</span>
      </span>
    </Link>
  );
}
