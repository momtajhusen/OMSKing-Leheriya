import { Outlet, Link, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { ShoppingBag, Warehouse, Receipt, Check, ArrowLeft } from 'lucide-react';
import BrandMark from '../marketing/BrandMark';
import PageFade from '../motion/PageFade';
import { HeroBackdrop, Eyebrow, ChannelMarquee, CHANNEL_DOTS } from '../marketing/MktKit';
import MktImage from '../marketing/MktImage';
import { LEGAL_LINKS } from '../../pages/public/LegalPage';
import { cn } from '../../lib/utils';

const panelPoints = ['Master SKU stock', 'Vendor routing', 'Delhivery shipping', 'GST invoices'];

const panelCards = [
  { icon: ShoppingBag, hint: 'New order · Shopify', title: '68798-LEH', pos: '-left-4 top-6', well: 'from-emerald-400 to-teal-500' },
  { icon: Warehouse, hint: 'Reserved · WH-001', title: '2 units, offline', pos: '-right-4 bottom-10 mkt-float-delay', well: 'from-amber-400 to-orange-500' },
  { icon: Receipt, hint: 'Invoice ready', title: 'CGST + SGST', pos: '-top-4 right-10', well: 'from-teal-500 to-emerald-700' },
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

  if (isLogin) {
    return (
      <div className="auth-split relative grid min-h-dvh bg-[#f3f8f5] lg:grid-cols-[1.05fr_1fr]">
        <aside className="mkt-hero relative isolate hidden overflow-hidden px-10 py-9 text-white lg:sticky lg:top-0 lg:h-dvh lg:self-start lg:flex lg:flex-col xl:px-14">
          <HeroBackdrop />
          <div className="mkt-rise">
            <BrandMark dark tagline />
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col py-6 [@media(max-height:760px)]:py-4">
            <div className="relative max-w-lg shrink-0">
              <div className="mkt-rise" style={{ '--rise-delay': '80ms' }}>
                <Eyebrow dark>Multichannel OMS · Live with Leheriya Creations</Eyebrow>
              </div>
              <h2 className="mkt-rise mt-5 text-4xl font-extrabold leading-[1.05] xl:text-5xl [@media(max-height:800px)]:mt-4 [@media(max-height:800px)]:text-4xl" style={{ '--rise-delay': '140ms' }}>
                Every channel.
                <br />
                <span className="mkt-gradient-text-light">One order desk.</span>
              </h2>
              <p className="mkt-rise mt-4 text-base leading-7 text-emerald-50/80" style={{ '--rise-delay': '200ms' }}>
                Shopify, Amazon, Myntra, Flipkart, Meesho, AJIO and Nykaa orders land in one Master Order — stock counted once, GST on every invoice.
              </p>
              <ul className="mkt-rise mt-6 grid grid-cols-2 gap-x-4 gap-y-2.5 [@media(max-height:800px)]:hidden" style={{ '--rise-delay': '260ms' }}>
                {panelPoints.map((point) => (
                  <li key={point} className="flex items-center gap-2 text-sm font-medium text-emerald-50">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-lime-300/20 text-lime-200">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative mt-7 min-h-0 flex-1 [@media(max-height:760px)]:mt-5 [@media(max-height:620px)]:hidden">
              <div className="mkt-rise absolute inset-0 rounded-[1.75rem] bg-white/10 p-1.5 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.6)] ring-1 ring-white/20 backdrop-blur" style={{ '--rise-delay': '320ms' }}>
                <MktImage name="login-hero" priority className="h-full rounded-[1.4rem]" aspectClassName="h-full w-full" />
              </div>
              {panelCards.map((card) => (
                <div
                  key={card.title}
                  className={cn('mkt-float absolute z-10 flex items-center gap-3 rounded-2xl [@media(max-height:780px)]:hidden border border-white/20 bg-emerald-950/55 px-3.5 py-2.5 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] backdrop-blur-md', card.pos)}
                >
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md', card.well)}>
                    <card.icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-[11px] text-emerald-100/75">{card.hint}</span>
                    <span className="block text-sm font-semibold text-white">{card.title}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative -mx-10 xl:-mx-14">
            <p className="mb-3 px-10 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-100/60 xl:px-14">Orders flow in from</p>
            <ChannelMarquee items={CHANNEL_DOTS} dark />
          </div>
        </aside>

        <main className="relative flex min-h-dvh flex-col overflow-x-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <div className="mkt-grid-bg-light" aria-hidden="true" />
          <div className="pointer-events-none absolute -right-24 -top-24 h-[22rem] w-[22rem] rounded-full bg-emerald-300/25 blur-3xl animate-float" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-[20rem] w-[20rem] rounded-full bg-lime-300/20 blur-3xl animate-float-slow" />

          <header className="relative z-20 flex items-center justify-between px-5 py-4 sm:px-8">
            <span className="lg:invisible">
              <BrandMark tagline />
            </span>
            <Link
              to="/"
              className="group inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/80 px-4 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:text-emerald-700"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-0.5" />
              Back to home
            </Link>
          </header>

          <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-6">
            <div className="w-full max-w-[440px]">
              <PageFade>
                <Outlet />
              </PageFade>
              <nav className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500" aria-label="Legal">
                {LEGAL_LINKS.map((item) => (
                  <Link key={item.to} to={item.to} className="font-medium text-emerald-800 hover:underline">{item.label}</Link>
                ))}
              </nav>
            </div>
          </div>
        </main>
      </div>
    );
  }

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

      <div className="relative z-10 flex items-start justify-center px-4 pb-10 pt-2 sm:pt-4">
        <div className="relative w-full max-w-[640px]">
          <PageFade>
            <Outlet />
          </PageFade>
          <nav className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500" aria-label="Legal">
            {LEGAL_LINKS.map((item) => (
              <Link key={item.to} to={item.to} className="font-medium text-emerald-800 hover:underline">{item.label}</Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
