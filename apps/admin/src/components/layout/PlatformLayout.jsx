import { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  LayoutDashboard, Building2, Shield, LogOut, Sun, Moon, Activity, ListTodo,
  FileWarning, Settings, CreditCard, Users, Menu, X,
} from 'lucide-react';
import useThemeStore from '../../stores/themeStore';
import { useAuth } from '../../hooks/useAuth';
import PageFade from '../motion/PageFade';
import BrandLogo from '../brand/BrandLogo';

const GROUPS = [
  {
    label: 'Control',
    items: [
      { path: '/platform', label: 'Overview', icon: LayoutDashboard },
      { path: '/platform/tenants', label: 'Subscribers', icon: Building2 },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { path: '/platform/plans', label: 'Plans', icon: CreditCard },
      { path: '/platform/users', label: 'Staff', icon: Users },
    ],
  },
  {
    label: 'Ops',
    items: [
      { path: '/platform/health', label: 'Health', icon: Activity },
      { path: '/platform/jobs', label: 'Jobs', icon: ListTodo },
      { path: '/platform/logs', label: 'Logs', icon: FileWarning },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/platform/auth', label: 'Auth', icon: Shield },
      { path: '/platform/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const FLAT = GROUPS.flatMap((g) => g.items);
const TABS = [
  { path: '/platform', label: 'Home' },
  { path: '/platform/tenants', label: 'Tenants' },
  { path: '/platform/health', label: 'Health' },
  { path: '/platform/jobs', label: 'Jobs' },
];

function isActive(pathname, path) {
  if (path === '/platform') return pathname === '/platform';
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function PlatformLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeStore();
  const { logout, user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const current = FLAT.find((item) => isActive(location.pathname, item.path)) || FLAT[0];
  const initial = (user?.name || user?.email || 'P').charAt(0).toUpperCase();

  const Nav = ({ onClick }) =>
    GROUPS.map((group) => (
      <div key={group.label} className="mb-4">
        <p className="mb-1.5 px-5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
        {group.items.map((item) => {
          const Icon = item.icon;
          const active = isActive(location.pathname, item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onClick}
              className={cn('sidebar-item mx-2 mb-0.5', active ? 'sidebar-item-active' : 'sidebar-item-inactive')}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label === 'Staff' ? 'Platform users' : item.label === 'Health' ? 'Integration health' : item.label === 'Logs' ? 'Error logs' : item.label === 'Auth' ? 'Authentication' : item.label}
            </Link>
          );
        })}
      </div>
    ));

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[hsl(var(--color-muted)/0.35)] pt-[env(safe-area-inset-top)]">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {mobileOpen && (
          <button type="button" className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
        )}

        <aside
          className={cn(
            'premium-sidebar z-50 flex w-[250px] shrink-0 flex-col transition-transform lg:relative lg:translate-x-0',
            'fixed inset-y-0 left-0 lg:static',
            mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          )}
        >
          <div className="flex h-16 items-center justify-between border-b border-[hsl(var(--color-border-premium))] px-4">
            <div className="flex items-center gap-2.5">
              <BrandLogo className="h-9 w-9" />
              <div>
                <div className="text-sm font-bold leading-none">OMSKing</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">SaaS control</div>
              </div>
            </div>
            <button type="button" className="rounded-lg p-1 lg:hidden" onClick={() => setMobileOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto py-3">
            <Nav onClick={() => setMobileOpen(false)} />
          </nav>
          <div className="border-t border-[hsl(var(--color-border-premium))] p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-700 to-lime-600 text-sm font-bold text-white">
                {initial}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{user?.name || 'Platform'}</div>
                <div className="truncate text-[11px] text-muted-foreground">{user?.email}</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[hsl(var(--color-border-premium))] bg-background/90 px-4 backdrop-blur-md sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)}>
                <Menu className="h-5 w-5" />
              </button>
              <BrandLogo className="h-8 w-8 lg:hidden" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{current.label === 'Staff' ? 'Platform users' : current.label === 'Health' ? 'Integration health' : current.label}</p>
                <p className="truncate text-[11px] text-muted-foreground">Not a packing desk — tenants, plans, jobs</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={toggleTheme} className="rounded-lg p-2 hover:bg-muted" aria-label="Toggle theme">
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                onClick={async () => { await logout(); navigate('/auth/login'); }}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0">
            <PageFade>
              <Outlet />
            </PageFade>
          </main>
        </div>
      </div>

      <nav className="mkt-bottom-nav lg:hidden" aria-label="Platform navigation">
        {TABS.map((tab) => {
          const Icon = FLAT.find((i) => i.path === tab.path)?.icon || LayoutDashboard;
          const active = isActive(location.pathname, tab.path);
          return (
            <Link key={tab.path} to={tab.path} className={cn(active && 'is-active')}>
              <Icon className="h-5 w-5" />
              {tab.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMobileOpen(true)}>
          <Menu className="h-5 w-5" />
          More
        </button>
      </nav>
    </div>
  );
}
