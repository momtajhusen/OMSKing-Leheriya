import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, PackageCheck, Truck, Menu, Receipt, X } from 'lucide-react';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';
import PageFade from '../motion/PageFade';
import { useAuth } from '../../hooks/useAuth';
import Button from '../ui/Button';
import useUIStore from '../../stores/uiStore';
import { cn } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';
import ProductImageCatalog from '../catalog/ProductImageCatalog';
import api from '../../lib/api';

const TABS = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/fulfilment', label: 'Pack', icon: PackageCheck },
  { to: '/shipping', label: 'Ship', icon: Truck },
];

const BILL_NOTICE_KEY = 'oms-bill-notice';

function noticeStamp(billing) {
  if (!billing?.message) return '';
  return `${billing.period || ''}|${billing.monthStatus || ''}|${billing.message}`;
}

function BillingNotice({ billing, onOpen, onClose }) {
  const warn = billing.tone === 'warn';
  return (
    <div
      role="status"
      className={cn(
        'admin-notice relative z-30 shrink-0 border-b px-3 py-2.5 sm:px-4',
        warn
          ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-700/40 dark:bg-amber-950 dark:text-amber-50'
          : 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-700/40 dark:bg-emerald-950 dark:text-emerald-50'
      )}
    >
      <div className="flex items-start gap-2.5 pr-8 sm:items-center sm:gap-3 sm:pr-10">
        <span className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white sm:mt-0',
          warn ? 'bg-amber-600' : 'bg-emerald-700'
        )}>
          <Receipt className="h-4 w-4" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-sm leading-5">{billing.message}</p>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              'hidden h-8 shrink-0 items-center rounded-full px-3.5 text-xs font-semibold text-white sm:inline-flex',
              warn ? 'bg-amber-800 hover:bg-amber-900' : 'bg-emerald-800 hover:bg-emerald-900'
            )}
          >
            View details
          </button>
        )}
      </div>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            'ml-10 mt-2 inline-flex h-8 items-center rounded-full px-3.5 text-xs font-semibold text-white sm:hidden',
            warn ? 'bg-amber-800 hover:bg-amber-900' : 'bg-emerald-800 hover:bg-emerald-900'
          )}
        >
          View details
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close notice"
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, exitImpersonation } = useAuth();
  const { canOpenPath } = usePermissions();
  const setMobileOpen = useUIStore((state) => state.setMobileOpen);
  const [billing, setBilling] = useState(null);
  const [closedStamp, setClosedStamp] = useState(() => sessionStorage.getItem(BILL_NOTICE_KEY) || '');

  useEffect(() => {
    if (!user?.tenantId || (user.role === 'platform_admin' && !user.impersonating)) {
      setBilling(null);
      return undefined;
    }
    let alive = true;
    api.get('/pricing/mine')
      .then(({ data }) => { if (alive) setBilling(data.data || null); })
      .catch(() => { if (alive) setBilling(null); });
    return () => { alive = false; };
  }, [user?.tenantId, user?.role, user?.impersonating, user?.tenantStatus]);

  const leaveTenant = async () => {
    await exitImpersonation();
    navigate('/platform');
  };

  const stamp = noticeStamp(billing);
  const showNotice = Boolean(stamp) && closedStamp !== stamp;
  const openBill = () => navigate('/subscription');
  const closeNotice = () => {
    sessionStorage.setItem(BILL_NOTICE_KEY, stamp);
    setClosedStamp(stamp);
  };

  return (
    <div className="admin-shell flex h-dvh flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)]">
      {showNotice && (
        <BillingNotice
          billing={billing}
          onOpen={canOpenPath('/subscription') && location.pathname !== '/subscription' ? openBill : null}
          onClose={closeNotice}
        />
      )}
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
        <ProductImageCatalog />
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
