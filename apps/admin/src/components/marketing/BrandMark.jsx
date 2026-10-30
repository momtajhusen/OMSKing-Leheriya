import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import BrandLogo from '../brand/BrandLogo';

export default function BrandMark({ className, markClassName, wordmarkClassName, tagline = false, dark = false }) {
  return (
    <Link to="/" className={cn('group/brand flex items-center gap-2.5', className)} aria-label="OMSKing home">
      <span className={cn('mkt-brand-mark', dark && 'mkt-brand-mark-dark')}>
        <BrandLogo className={cn('relative h-9 w-9', markClassName)} />
      </span>
      <span className="flex flex-col leading-none">
        <span className={cn('mkt-brand-word text-[18px] font-extrabold', dark ? 'text-white' : 'text-slate-900', wordmarkClassName)}>
          OMS<span className={dark ? 'mkt-gradient-text-light' : 'mkt-gradient-text'}>King</span>
        </span>
        {tagline && (
          <span className={cn('mt-1 text-[9.5px] font-semibold uppercase tracking-[0.22em]', dark ? 'text-emerald-100/80' : 'text-slate-500')}>
            Multichannel OMS
          </span>
        )}
      </span>
    </Link>
  );
}
