import { Outlet, Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { Package, ShoppingCart, Truck, RotateCcw, Settings, LayoutDashboard } from 'lucide-react';
import useThemeStore from '../../stores/themeStore';

const vendorRoutes = [
  { path: '/vendor/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/vendor/orders', label: 'Orders', icon: ShoppingCart },
  { path: '/vendor/products', label: 'Products', icon: Package },
  { path: '/vendor/shipping', label: 'Shipping', icon: Truck },
  { path: '/vendor/returns', label: 'Returns', icon: RotateCcw },
  { path: '/vendor/settings', label: 'Settings', icon: Settings },
];

function VendorLayout() {
  const { theme, toggleTheme } = useThemeStore();
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-background text-[13px] leading-tight">
      <aside className="w-48 border-r bg-muted/30 flex flex-col">
        <div className="h-14 border-b px-4 flex items-center">
          <div className="font-semibold text-sm">Vendor Console</div>
        </div>
        <nav className="flex-1 py-2">
          {vendorRoutes.map((route) => {
            const Icon = route.icon;
            const isActive = location.pathname === route.path;
            
            return (
              <Link
                key={route.path}
                to={route.path}
                className={cn(
                  'flex items-center px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4 mr-2" />
                {route.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <div className="text-xs text-muted-foreground">Sandeep Textiles</div>
        </div>
      </aside>
      
      <div className="flex-1 flex flex-col">
        <header className="h-14 border-b bg-background px-4 flex items-center justify-between">
          <div className="font-medium">Vendor Dashboard</div>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded hover:bg-accent"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default VendorLayout;