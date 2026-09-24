import { Outlet, Link, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Store, ShoppingBag, Shirt, Warehouse } from 'lucide-react';
import BrandMark from '../marketing/BrandMark';
import PageFade from '../motion/PageFade';
import { cn } from '../../lib/utils';

const floaters = [
  { icon: Store, label: 'Shopify', hint: 'Storefront', pos: 'hidden lg:flex -left-44 top-10', well: 'from-emerald-400 to-teal-500' },
  { icon: ShoppingBag, label: 'Amazon', hint: 'SP-API', pos: 'hidden lg:flex -right-44 top-24', well: 'from-amber-400 to-orange-500' },
  { icon: Shirt, label: 'Myntra', hint: 'Partner API', pos: 'hidden lg:flex -right-40 bottom-16', well: 'from-pink-400 to-rose-500' },
  { icon: Warehouse, label: 'WH-001', hint: 'Offline stock', pos: 'hidden lg:flex -left-40 bottom-10', well: 'from-emerald-600 to-teal-700' },
];

export default function AuthLayout() {
  const { pathname } = useLocation();
  const isLogin = pathname.includes('/login');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark');
    root.classList.add('force-light');
    return () => {
      root.classList.remove('force-light');
      const stored = localStorage.getItem('oms-theme');
      if (stored === 'dark') root.classList.add('dark');
    };
  }, []);

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[#f3f8f5] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgb(148 163 184 / 0.35) 1px, transparent 0)',
          backgroundSize: '28px 28px',
        }}
      />
      <div className="pointer-events-none absolute -left-28 -top-20 h-[28rem] w-[28rem] rounded-full bg-emerald-400/25 blur-3xl animate-float" />
      <div className="pointer-events-none absolute -right-24 -bottom-24 h-[30rem] w-[30rem] rounded-full bg-lime-400/20 blur-3xl animate-float-slow" />

      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <BrandMark />
        <Link
          to="/"
          className="rounded-full border border-slate-200/80 bg-white/80 px-4 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:text-emerald-700"
        >
          Back to home
        </Link>
      </header>

      <div
        className={cn(
          'relative z-10 flex justify-center px-4 pb-10',
          isLogin ? 'min-h-[calc(100dvh-72px)] items-center py-6' : 'items-start pt-2 sm:pt-4'
        )}
      >
        <div className={cn('relative w-full', isLogin ? 'max-w-[440px]' : 'max-w-[480px]')}>
          {isLogin &&
            floaters.map((item) => (
              <div
                key={item.label}
                className={cn(
                  'absolute items-center gap-3 rounded-2xl border border-white/80 bg-white/90 px-3.5 py-2.5 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.35)] backdrop-blur',
                  item.pos
                )}
              >
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md', item.well)}>
                  <item.icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                  <span className="block text-[11px] text-slate-500">{item.hint}</span>
                </span>
              </div>
            ))}

          <PageFade>
            <Outlet />
          </PageFade>
        </div>
      </div>
    </div>
  );
}
