import { Outlet, NavLink, Link, useLocation } from 'react-router-dom';
import { Menu, X, Mail, Phone, MapPin, Sparkles, Layers, BadgeIndianRupee, Info, MessageCircle, LogIn, Home } from 'lucide-react';
import { useEffect, useState } from 'react';
import BrandMark from '../marketing/BrandMark';
import { MarketingCta } from '../marketing/MarketingCta';
import PageFade from '../motion/PageFade';
import { CONTACT_ITEMS } from '../marketing/StickyContactDock';
import StickyContactDock from '../marketing/StickyContactDock';
import { cn } from '../../lib/utils';

const NAV = [
  { to: '/#why', label: 'How it works', hash: true, icon: Sparkles },
  { to: '/features', label: 'Features', icon: Layers },
  { to: '/pricing', label: 'Pricing', icon: BadgeIndianRupee },
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
  const location = useLocation();

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
      window.scrollTo(0, 0);
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

  const linkClass = (active) =>
    `nav-link-mkt text-[13px] font-medium transition-colors ${active ? 'text-blue-700 nav-link-mkt-active' : 'text-slate-600 hover:text-slate-900'}`;

  const isActive = (item) => {
    if (item.hash) return location.pathname === '/' && location.hash === '#why';
    return location.pathname === item.to;
  };

  return (
    <div className="marketing-site flex min-h-dvh flex-col bg-white text-slate-900">
      <header className="sticky top-0 z-50 border-b border-white/60 bg-white/90 shadow-sm backdrop-blur-xl">
        <div className="mkt-appbar mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandMark />

          <nav className="hidden items-center gap-6 lg:flex">
            {NAV.map((item) => {
              const Icon = item.icon;
              const inner = (
                <>
                  <Icon className="h-3.5 w-3.5 opacity-70" />
                  {item.label}
                </>
              );
              return item.hash ? (
                <Link key={item.to} to={item.to} className={`${linkClass(false)} inline-flex items-center gap-1.5`}>
                  {inner}
                </Link>
              ) : (
                <NavLink key={item.to} to={item.to} className={({ isActive: on }) => `${linkClass(on)} inline-flex items-center gap-1.5`}>
                  {inner}
                </NavLink>
              );
            })}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <MarketingCta to="/auth/login" variant="ghost">
              Login
            </MarketingCta>
            <MarketingCta to="/contact">
              See Leheriya’s desk
            </MarketingCta>
          </div>

          <button
            type="button"
            className="rounded-xl p-2 text-slate-700 ring-1 ring-slate-200 lg:hidden"
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
          <aside className="mkt-drawer" role="dialog" aria-modal="true" aria-label="Site menu">
            <div className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-indigo-700 to-violet-700 px-5 pb-8 pt-5 text-white">
              <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10" />
              <div className="flex items-center justify-between">
                <BrandMark className="[&_span:last-child]:text-white [&_.text-blue-700]:text-sky-200" markClassName="bg-white text-blue-700" />
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-full bg-white/15 p-2 text-white"
                  aria-label="Close menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">First tenant</p>
              <p className="mt-1 text-lg font-bold">Leheriya Creations</p>
              <p className="mt-1 text-sm text-blue-100">Shopify · Amazon · Myntra</p>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4">
              {NAV.map((item) => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'mb-1 flex items-center gap-3 rounded-2xl px-3 py-3.5 text-sm font-semibold transition',
                      active ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-50'
                    )}
                  >
                    <span className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-xl',
                      active ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-blue-700'
                    )}>
                      <Icon className="h-4 w-4" />
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto space-y-3 border-t border-slate-100 px-4 py-4">
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
              <MarketingCta to="/contact" className="h-12 w-full">
                See Leheriya’s desk
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

      <footer className="hidden border-t border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100 lg:block">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-1">
            <BrandMark />
            <p className="mt-4 text-sm leading-6 text-slate-600">
              SaaS OMS built for Leheriya Creations. Shopify, Amazon and Myntra — one tenant per merchant.
            </p>
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Product</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Link to="/features" className="hover:text-blue-700">Features</Link></li>
              <li><Link to="/pricing" className="hover:text-blue-700">Pricing</Link></li>
              <li><Link to="/#why" className="hover:text-blue-700">How it works</Link></li>
              <li><Link to="/auth/login" className="hover:text-blue-700">Login</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Company</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Link to="/about" className="hover:text-blue-700">About</Link></li>
              <li><Link to="/contact" className="hover:text-blue-700">Contact</Link></li>
              <li><Link to="/auth/register" className="hover:text-blue-700">Start trial</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Contact</h3>
            <ul className="space-y-3 text-sm text-slate-600">
              <li className="flex gap-2"><Mail className="mt-0.5 h-4 w-4 text-blue-700" />support@omsking.com</li>
              <li className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 text-blue-700" />+91 98765 43210</li>
              <li className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 text-blue-700" />Jaipur, India</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-200 py-5 text-center text-xs text-slate-500">
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
