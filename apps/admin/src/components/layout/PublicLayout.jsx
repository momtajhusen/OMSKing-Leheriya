import { Outlet, Link, useLocation } from 'react-router-dom';
import { Menu, X, Mail, Phone, MapPin, Sparkles, Layers, BadgeIndianRupee, Info, MessageCircle, LogIn, Home, PlayCircle, ArrowRight, ChevronRight, Clock, FileText, Shield, Receipt, Cookie, Workflow, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import BrandMark from '../marketing/BrandMark';
import { MarketingCta } from '../marketing/MarketingCta';
import { CHANNEL_DOTS } from '../marketing/MktKit';
import PageFade from '../motion/PageFade';
import { CONTACT_EMAIL, CONTACT_ITEMS, CONTACT_PHONE_DISPLAY, CONTACT_PHONE_HREF, CONTACT_WHATSAPP_DISPLAY, CONTACT_WHATSAPP_HREF, CONTACT_HOURS } from '../marketing/StickyContactDock';
import StickyContactDock from '../marketing/StickyContactDock';
import { LEGAL_LINKS } from '../../pages/public/LegalPage';
import { cn } from '../../lib/utils';
import { scrollPageToTop } from '../../lib/scrollPageToTop';

const FOOTER_ICON_TILE = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200';

const LEGAL_ICONS = { '/terms': FileText, '/privacy': Shield, '/billing': Receipt, '/cookies': Cookie };

const FOOTER_LINKS = {
  Product: [
    { to: '/features', label: 'Features', icon: Layers },
    { to: '/pricing', label: 'Pricing', icon: BadgeIndianRupee },
    { to: '/#why', label: 'How it works', icon: Workflow },
    { to: '/auth/login', label: 'Login', icon: LogIn },
  ],
  Company: [
    { to: '/about', label: 'About', icon: Info },
    { to: '/contact', label: 'Contact', icon: MessageCircle },
    { to: '/auth/register', label: 'Start trial', icon: Rocket },
    { to: '/demo', label: 'Request a demo', icon: PlayCircle },
  ],
  Legal: LEGAL_LINKS.map((item) => ({ ...item, icon: LEGAL_ICONS[item.to] || FileText })),
};

const NAV = [
  { to: '/#why', label: 'How it works', hash: true, icon: Sparkles },
  { to: '/features', label: 'Features', icon: Layers },
  { to: '/pricing', label: 'Pricing', icon: BadgeIndianRupee },
  { to: '/demo', label: 'Demo request', icon: PlayCircle },
  { to: '/about', label: 'About', icon: Info },
  { to: '/contact', label: 'Contact', icon: MessageCircle },
];

const TABS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/features', label: 'Features', icon: Layers },
  { to: '/pricing', label: 'Pricing', icon: BadgeIndianRupee },
  { to: '/contact', label: 'Contact', icon: MessageCircle },
];

export default function PublicLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const root = document.getElementById('root');
    const onScroll = (event) => {
      const target = event?.target;
      if (target && target !== document && target !== root) return;
      setScrolled(Math.max(window.scrollY, root?.scrollTop || 0) > 12);
    };
    onScroll();
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark');
    root.classList.add('marketing', 'force-light');
    return () => {
      root.classList.remove('marketing', 'force-light');
      const stored = localStorage.getItem('oms-theme');
      if (stored === 'dark') root.classList.add('dark');
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      scrollPageToTop();
    }
  }, [location.pathname, location.hash]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    const onKey = (event) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  const isActive = (item) => {
    if (item.hash) return location.pathname === '/' && location.hash === '#why';
    return location.pathname === item.to;
  };

  return (
    <div className="marketing-site flex min-h-dvh flex-col bg-white text-slate-900">
      <header
        className={cn(
          'sticky top-0 z-50 border-b transition-all duration-500 ease-premium',
          scrolled
            ? 'border-slate-200/80 bg-white/85 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)] backdrop-blur-xl lg:border-transparent lg:bg-transparent lg:shadow-none lg:backdrop-blur-none'
            : 'border-slate-100 bg-white'
        )}
      >
        <span className={cn('mkt-header-line', scrolled && 'lg:opacity-0')} aria-hidden="true" />
        <div
          className={cn(
            'mkt-appbar mx-auto flex max-w-6xl items-center justify-between px-4 transition-all duration-500 ease-premium sm:px-6',
            scrolled
              ? 'h-16 lg:mt-2 lg:h-14 lg:w-[calc(100%-2rem)] lg:max-w-[70rem] lg:rounded-2xl lg:border lg:border-white/70 lg:bg-white/80 lg:px-4 lg:shadow-[0_18px_40px_-20px_rgba(6,40,31,0.45)] lg:ring-1 lg:ring-slate-900/5 lg:backdrop-blur-xl'
              : 'h-[72px]'
          )}
        >
          <BrandMark tagline />

          <nav className="mkt-nav hidden items-center gap-0.5 rounded-full p-1 lg:flex" aria-label="Main">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn('mkt-nav-pill group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-semibold xl:px-3.5', active && 'is-active')}
                >
                  <Icon className="hidden h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-px group-hover:scale-110 xl:block" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-1.5 lg:flex">
            <Link
              to="/auth/login"
              className="group inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <LogIn className="hidden h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 xl:block" />
              Login
            </Link>
            <MarketingCta to="/demo" className="px-4 py-2 text-[13px]">
              Request a demo
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </MarketingCta>
          </div>

          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50 to-lime-50 text-emerald-800 ring-1 ring-emerald-200/70 transition duration-300 hover:shadow-md active:scale-95 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="lg:hidden">
          <button type="button" className="mkt-drawer-scrim hidden sm:block" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
          <aside className="mkt-drawer overflow-y-auto" role="dialog" aria-modal="true" aria-label="Site menu">
            <div className="mkt-hero relative isolate shrink-0 overflow-hidden px-5 pb-7 pt-5 text-white">
              <div className="mkt-hero-mesh" aria-hidden="true" />
              <div className="mkt-grid-bg" aria-hidden="true" />
              <div className="flex items-center justify-between">
                <BrandMark dark tagline />
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/20 transition duration-300 hover:rotate-90 hover:bg-white/25"
                  aria-label="Close menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-6 text-xl font-bold leading-tight">
                Every channel, <span className="mkt-gradient-text-light">one order desk.</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CHANNEL_DOTS.slice(0, 7).map((item) => (
                  <span key={item.name} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-50 ring-1 ring-white/15">
                    <span className={cn('h-1.5 w-1.5 rounded-full', item.dot)} />
                    {item.name}
                  </span>
                ))}
              </div>
            </div>

            <nav className="shrink-0 px-3 py-4" aria-label="Site">
              {NAV.map((item, index) => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    style={{ '--rise-delay': `${60 + index * 45}ms` }}
                    className={cn(
                      'mkt-rise group relative mb-1 flex items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 text-sm font-semibold transition',
                      active ? 'bg-gradient-to-r from-emerald-50 to-lime-50/60 text-emerald-800' : 'text-slate-700 hover:bg-slate-50'
                    )}
                  >
                    {active && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-gradient-to-b from-emerald-500 to-lime-400" aria-hidden="true" />}
                    <span className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105',
                      active ? 'bg-gradient-to-br from-emerald-600 to-lime-500 text-white shadow-md shadow-emerald-700/25' : 'bg-slate-100 text-emerald-700'
                    )}>
                      <Icon className="h-4 w-4" />
                    </span>
                    {item.label}
                    <ChevronRight className={cn('ml-auto h-4 w-4 transition-transform duration-300 group-hover:translate-x-1', active ? 'text-emerald-600' : 'text-slate-300')} />
                  </Link>
                );
              })}
            </nav>

            <div className="shrink-0 border-t border-slate-100 px-3 py-3">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Legal</p>
              {LEGAL_LINKS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="mb-1 flex items-center rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="mt-auto shrink-0 space-y-3 border-t border-slate-100 px-4 py-4">
              <div className="grid grid-cols-3 gap-2">
                {CONTACT_ITEMS.map((item) => {
                  const Icon = item.Icon;
                  return (
                    <a
                      key={item.id}
                      href={item.href}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noopener noreferrer' : undefined}
                      className="flex flex-col items-center gap-1.5 rounded-2xl bg-slate-50 py-3 text-[11px] font-semibold text-slate-700"
                    >
                      <span className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${item.well}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      {item.id === 'call' ? 'Call' : item.label}
                    </a>
                  );
                })}
              </div>
              <Link
                to="/auth/login"
                className="flex h-12 items-center justify-center gap-2 rounded-full border border-slate-200 text-sm font-semibold text-slate-700"
              >
                <LogIn className="h-4 w-4" />
                Login
              </Link>
              <MarketingCta to="/demo" className="h-12 w-full">
                Request a demo
              </MarketingCta>
            </div>
          </aside>
        </div>
      )}

      <main className="flex-1 pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0">
        <PageFade>
          <Outlet />
        </PageFade>
      </main>

      <footer className="relative border-t border-slate-200 bg-slate-50 pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bg-gradient-to-b lg:from-slate-50 lg:to-slate-100 lg:pb-0">
        <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500 via-lime-400 to-teal-500" aria-hidden="true" />
        <div className="mx-auto hidden max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid lg:grid-cols-5">
          <div className="md:col-span-1">
            <BrandMark tagline />
            <p className="mt-4 text-sm leading-6 text-slate-600">
              Multichannel OMS for Indian brands. Shopify, Amazon, Myntra, Flipkart, Meesho, AJIO and Nykaa on one desk — one tenant per merchant. Live with Leheriya Creations.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {['Shopify', 'Amazon', 'Myntra', 'Flipkart', 'Meesho', 'AJIO', 'Nykaa'].map((name) => (
                <span key={name} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 transition duration-200 hover:text-emerald-700 hover:ring-emerald-200">
                  {name}
                </span>
              ))}
            </div>
          </div>
          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <div key={heading}>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">{heading}</h3>
              <ul className="space-y-1.5 text-sm text-slate-600">
                {links.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to} className="group inline-flex items-center gap-2.5 py-0.5 transition-colors hover:text-emerald-700">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200 transition duration-300 group-hover:-rotate-6 group-hover:bg-gradient-to-br group-hover:from-emerald-500 group-hover:to-lime-500 group-hover:text-white group-hover:ring-transparent">
                        <link.icon className="h-3.5 w-3.5" strokeWidth={2.1} />
                      </span>
                      <span className="transition-transform duration-300 group-hover:translate-x-0.5">{link.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Contact</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li className="flex items-center gap-2.5"><span className={FOOTER_ICON_TILE}><Mail className="h-3.5 w-3.5" /></span><a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-emerald-700">{CONTACT_EMAIL}</a></li>
              <li className="flex items-center gap-2.5"><span className={FOOTER_ICON_TILE}><Phone className="h-3.5 w-3.5" /></span><a href={CONTACT_PHONE_HREF} className="hover:text-emerald-700">{CONTACT_PHONE_DISPLAY}</a></li>
              <li className="flex items-center gap-2.5"><span className={FOOTER_ICON_TILE}><MessageCircle className="h-3.5 w-3.5" /></span><a href={CONTACT_WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-700">{CONTACT_WHATSAPP_DISPLAY} <span className="text-xs text-slate-400">(WhatsApp only)</span></a></li>
              <li className="flex items-center gap-2.5"><span className={FOOTER_ICON_TILE}><Clock className="h-3.5 w-3.5" /></span>{CONTACT_HOURS}</li>
              <li className="flex items-center gap-2.5"><span className={FOOTER_ICON_TILE}><MapPin className="h-3.5 w-3.5" /></span>Jaipur, India</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-200 px-4 py-5 text-center text-xs text-slate-500">
          <nav className="mb-2 flex flex-wrap justify-center gap-x-4 gap-y-1 lg:hidden" aria-label="Legal">
            {LEGAL_LINKS.map((item) => (
              <Link key={item.to} to={item.to} className="font-medium text-emerald-800">{item.label}</Link>
            ))}
          </nav>
          © 2026 OMSKing. First tenant: Leheriya Creations. Next tenant gets the same walls.
        </div>
      </footer>

      <StickyContactDock />

      <nav className="mkt-bottom-nav lg:hidden" aria-label="App navigation">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.to === '/' ? location.pathname === '/' : location.pathname === tab.to;
          return (
            <Link key={tab.to} to={tab.to} className={active ? 'is-active' : undefined}>
              <Icon className="h-5 w-5" />
              {tab.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMobileOpen(true)}>
          <Menu className="h-5 w-5" />
          Menu
        </button>
      </nav>
    </div>
  );
}
