import { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  Package, ShoppingCart, Truck, RotateCcw, Settings, LayoutDashboard, LogOut, Sun, Moon, Menu, X,
} from 'lucide-react';
import useThemeStore from '../../stores/themeStore';
import { useAuth } from '../../hooks/useAuth';
import PageFade from '../motion/PageFade';
import { usePermissions } from '../../hooks/usePermissions';
import BrandLogo from '../brand/BrandLogo';

const vendorRoutes = [
  { path: '/vendor/dashboard', label: 'Home', icon: LayoutDashboard },
  { path: '/vendor/orders', label: 'Orders', icon: ShoppingCart },
  { path: '/vendor/shipping', label: 'Ship', icon: Truck },
  { path: '/vendor/returns', label: 'Returns', icon: RotateCcw },
  { path: '/vendor/products', label: 'Stock', icon: Package },
  { path: '/vendor/settings', label: 'Settings', icon: Settings },
];

const TABS = vendorRoutes.slice(0, 4);

function VendorLayout() {
  const { theme, toggleTheme } = useThemeStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { canOpenPath } = usePermissions();
  const [mobileOpen, setMobileOpen] = useState(false);

  const current = vendorRoutes.find((r) => location.pathname === r.path) || vendorRoutes[1];
  const initial = (user?.name || 'V').charAt(0).toUpperCase();

  const handleLogout = async () => {
    await logout();
    navigate('/auth/login');
  };

  const NavLinks = ({ onClick }) =>
    vendorRoutes.filter((route) => canOpenPath(route.path)).map((route) => {
      const Icon = route.icon;
      const isActive = location.pathname === route.path;
      return (
        <Link
          key={route.path}
          to={route.path}
          onClick={onClick}
          className={cn('sidebar-item mx-2 mb-1', isActive ? 'sidebar-item-active' : 'sidebar-item-inactive')}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {route.label === 'Home' ? 'Dashboard' : route.label === 'Ship' ? 'Shipping' : route.label === 'Stock' ? 'Products' : route.label}
        </Link>
      );
    });

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[hsl(var(--color-muted)/0.35)] pt-[env(safe-area-inset-top)]">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {mobileOpen && (
          <button type="button" className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
        )}

        <aside
          className={cn(
            'premium-sidebar z-50 flex w-[240px] shrink-0 flex-col transition-transform lg:relative lg:translate-x-0',
            'fixed inset-y-0 left-0 lg:static',
            mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          )}
        >
          <div className="flex h-16 items-center justify-between border-b border-[hsl(var(--color-border-premium))] px-4">
            <div className="flex items-center gap-2.5">
              <BrandLogo className="h-9 w-9" />
              <div>
                <div className="text-sm font-bold leading-none">Vendor</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">OMSKing sheet</div>
              </div>
            </div>
            <button type="button" className="rounded-lg p-1 lg:hidden" onClick={() => setMobileOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto py-3">
            <p className="mb-2 px-5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Work</p>
            <NavLinks onClick={() => setMobileOpen(false)} />
          </nav>
          <div className="border-t border-[hsl(var(--color-border-premium))] p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 text-sm font-bold text-white">
                {initial}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{user?.name || 'Vendor'}</div>
                <div className="truncate text-[11px] text-muted-foreground">{user?.tenantName || 'Assigned vendor'}</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[hsl(var(--color-border-premium))] bg-background/90 px-4 backdrop-blur-md">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)}>
                <Menu className="h-5 w-5" />
              </button>
              <BrandLogo className="h-8 w-8 lg:hidden" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{current.label === 'Home' ? 'Dashboard' : current.label === 'Ship' ? 'Shipping' : current.label === 'Stock' ? 'Products' : current.label}</p>
                <p className="truncate text-[11px] text-muted-foreground">Fill the sheet. One Master Order per line.</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={toggleTheme} className="rounded-lg p-2 hover:bg-muted" aria-label="Toggle theme">
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>
              <button type="button" onClick={handleLogout} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive" title="Logout">
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

      <nav className="mkt-bottom-nav lg:hidden" aria-label="Vendor navigation">
        {TABS.filter((tab) => canOpenPath(tab.path)).map((tab) => {
          const Icon = tab.icon;
          const active = location.pathname === tab.path;
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

export default VendorLayout;
