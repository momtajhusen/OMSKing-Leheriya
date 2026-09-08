import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { ROUTE_DEFS } from '../../router';
import useUIStore from '../../stores/uiStore';
import { 
  LayoutDashboard, Shield, Building2, Users, FileText, Bell, Plug, Settings,
  Package, Barcode, GitCompare, Warehouse, Building, ShoppingCart, Truck, Store,
  PackageCheck, RotateCcw, ArrowDownLeft, AlertTriangle, FileSpreadsheet,
  CreditCard, RefreshCw, BarChart3, Palette, Box
} from 'lucide-react';

const iconMap = {
  LayoutDashboard, Shield, Building2, Users, FileText, Bell, Plug, Settings,
  Package, Barcode, GitCompare, Warehouse, Building, ShoppingCart, Truck, Store,
  PackageCheck, RotateCcw, ArrowDownLeft, AlertTriangle, FileSpreadsheet,
  CreditCard, RefreshCw, BarChart3, Palette, Box,
};

const groupLabels = {
  'Core Platform': 'Core Platform',
  'Catalog': 'Catalog',
  'Inventory & Storage': 'Inventory & Storage',
  'Orders & Fulfilment': 'Orders & Fulfilment',
  'Reverse Logistics': 'Reverse Logistics',
  'Finance': 'Finance',
};

function AdminSidebar() {
  const { sidebarCollapsed, toggleSidebar, activeRole, setActiveRole } = useUIStore();
  const location = useLocation();

  const groupedRoutes = ROUTE_DEFS.admin.reduce((acc, route) => {
    if (!acc[route.group]) acc[route.group] = [];
    acc[route.group].push(route);
    return acc;
  }, {});

  const filteredRoutes = groupedRoutes;

  return (
    <aside
      className={cn(
        'flex flex-col border-r bg-muted/40 transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex h-16 items-center border-b px-4">
        <Box className="h-6 w-6 text-primary" />
        {!sidebarCollapsed && (
          <span className="ml-2 font-semibold text-foreground">OMSKing</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        {Object.entries(filteredRoutes).map(([group, routes]) => (
          <div key={group} className="mb-4">
            {!sidebarCollapsed && (
              <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">
                {groupLabels[group] || group}
              </div>
            )}
            {routes.map((route) => {
              const Icon = iconMap[route.icon] || Box;
              const isActive = location.pathname === route.path;
              
              return (
                <Link
                  key={route.path}
                  to={route.path}
                  data-sidebar-link="true"
                  className={cn(
                    'flex items-center px-4 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    sidebarCollapsed && 'justify-center'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {!sidebarCollapsed && <span className="ml-2">{route.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t p-4">
        {!sidebarCollapsed && (
          <div className="text-xs text-muted-foreground mb-2">Role: {activeRole}</div>
        )}
        <div className="flex gap-1">
          <button
            onClick={() => setActiveRole('super_admin')}
            className={cn(
              'flex-1 rounded px-2 py-1 text-xs',
              activeRole === 'super_admin' ? 'bg-primary text-primary-foreground' : 'bg-muted'
            )}
          >
            {!sidebarCollapsed ? 'Super Admin' : 'SA'}
          </button>
          <button
            onClick={() => setActiveRole('vendor')}
            className={cn(
              'flex-1 rounded px-2 py-1 text-xs',
              activeRole === 'vendor' ? 'bg-primary text-primary-foreground' : 'bg-muted'
            )}
          >
            {!sidebarCollapsed ? 'Vendor' : 'V'}
          </button>
        </div>
      </div>
    </aside>
  );
}

export default AdminSidebar;