import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, PackageCheck, Truck, Menu } from 'lucide-react';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';
import PageFade from '../motion/PageFade';
import { useAuth } from '../../hooks/useAuth';
import Button from '../ui/Button';
import useUIStore from '../../stores/uiStore';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';

const TABS = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/fulfilment', label: 'Pack', icon: PackageCheck },
  { to: '/shipping', label: 'Ship', icon: Truck },
];

function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, exitImpersonation } = useAuth();
  const { canOpenPath } = usePermissions();
  const setMobileOpen = useUIStore((state) => state.setMobileOpen);

  const leaveTenant = async () => {
    await exitImpersonation();
    navigate('/platform');
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)]">
      {user?.impersonating && (
        <div className="flex h-10 shrink-0 items-center justify-center gap-3 bg-amber-500/15 px-4 text-sm text-amber-950 dark:text-amber-100">
          <span>
            Viewing <strong>{user.tenantName}</strong> as Super Admin
          </span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={leaveTenant}>
            Back to platform
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AdminHeader />
          <main className="flex-1 overflow-y-auto pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0">
            <PageFade className="page-container">
              <Outlet />
            </PageFade>
          </main>
        </div>
      </div>

      <nav className="mkt-bottom-nav lg:hidden" aria-label="Admin navigation">
        {TABS.filter((tab) => canOpenPath(tab.to)).map((tab) => {
          const Icon = tab.icon;
          const active = location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
          return (
            <Link key={tab.to} to={tab.to} className={cn(active && 'is-active')}>
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

export default AdminLayout;
