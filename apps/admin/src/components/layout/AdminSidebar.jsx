import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { ROUTE_DEFS } from '../../router';
import useUIStore from '../../stores/uiStore';
import { useAuth } from '../../hooks/useAuth';
import { ROLES, ROLE_LABELS } from '../../constants/roles';
import { ROUTE_PERMISSION, hasPermission, attachPermissions } from '../../constants/permissions';
import { 
  LayoutDashboard, Shield, Building2, Users, FileText, Bell, Plug, Settings,
  Package, Barcode, GitCompare, Warehouse, Building, ShoppingCart, Truck, Store,
  PackageCheck, RotateCcw, ArrowDownLeft, AlertTriangle, FileSpreadsheet,
  CreditCard, RefreshCw, BarChart3, Palette, Box, Radio, Webhook, Upload, Receipt,
  ChevronLeft, ChevronRight, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import BrandLogo from '../brand/BrandLogo';

const iconMap = {
  LayoutDashboard, Shield, Building2, Users, FileText, Bell, Plug, Settings,
  Package, Barcode, GitCompare, Warehouse, Building, ShoppingCart, Truck, Store,
  PackageCheck, RotateCcw, ArrowDownLeft, AlertTriangle, FileSpreadsheet,
  CreditCard, RefreshCw, BarChart3, Palette, Box, Radio, Webhook, Upload, Receipt,
};

const GROUP_ORDER = ['Daily', 'Stock', 'Returns', 'Catalog', 'Finance', 'Setup', 'Admin'];

const groupLabels = {
  Daily: 'Daily',
  Stock: 'Stock',
  Returns: 'Returns',
  Catalog: 'Catalog',
  Finance: 'Finance',
  Setup: 'Setup',
  Admin: 'Admin',
};

function revealActiveLink(container) {
  if (!container || container.clientHeight < 40) return;
  const active = container.querySelector('.sidebar-item-active');
  if (!active) return;
  const activeRect = active.getBoundingClientRect();
  const box = container.getBoundingClientRect();
  const pad = 8;
  if (activeRect.top < box.top + pad) {
    container.scrollTop -= box.top + pad - activeRect.top;
  } else if (activeRect.bottom > box.bottom - pad) {
    container.scrollTop += activeRect.bottom - (box.bottom - pad);
  }
}

function AdminSidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileOpen, setMobileOpen } = useUIStore();
  const desktopNavRef = useRef(null);
  const mobileNavRef = useRef(null);
  const { user, effectiveRole } = useAuth();
  const location = useLocation();
  const role = effectiveRole || ROLES.SUPER_ADMIN;
  const granted = attachPermissions(user)?.permissions || [];

  const groupedRoutes = ROUTE_DEFS.admin.reduce((acc, route) => {
    if (route.path === '/tenant-mgmt') return acc;
    const need = ROUTE_PERMISSION[route.path];
    if (need && !hasPermission(granted, need)) return acc;
    if (!acc[route.group]) acc[route.group] = [];
    acc[route.group].push(route);
    return acc;
  }, {});

  const filteredRoutes = Object.fromEntries(
    GROUP_ORDER.filter((group) => groupedRoutes[group]?.length).map((group) => [group, groupedRoutes[group]])
  );

  useLayoutEffect(() => {
    let observer;
    const navs = () => [desktopNavRef.current, mobileNavRef.current].filter(Boolean);
    const run = () => {
      const visible = navs().filter((node) => node.clientHeight >= 40 && node.querySelector('.sidebar-item-active'));
      if (!visible.length) return;
      visible.forEach(revealActiveLink);
      observer?.disconnect();
    };
    run();
    observer = new ResizeObserver(run);
    navs().forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Mobile Overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={cn(
              'flex flex-col premium-sidebar transition-all duration-300 relative h-screen overflow-hidden fixed z-50 lg:hidden',
              'w-[260px]'
            )}
          >
            {/* Logo Area */}
            <div className="flex h-14 items-center border-b border-[hsl(var(--color-border-premium))] px-4">
              <BrandLogo className="h-9 w-9" />
              <span className="ml-3 font-semibold text-lg tracking-tight">
                <span className="gradient-text">OMSKing</span>
              </span>
              {/* Mobile Close Button */}
              <button
                onClick={() => setMobileOpen(false)}
                className="ml-auto p-2 rounded-lg hover:bg-[hsl(var(--color-muted))] transition-all"
              >
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            {/* Navigation */}
            <div ref={mobileNavRef} className="flex-1 overflow-y-auto px-2 py-3">
              {Object.entries(filteredRoutes).map(([group, routes]) => (
                <div key={group} className="mb-2">
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {groupLabels[group] || group}
                  </div>
              {routes.map((route) => {
                const Icon = iconMap[route.icon] || Box;
                const isActive = location.pathname === route.path || (route.path !== '/' && location.pathname.startsWith(`${route.path}/`));
                
                return (
                  <Link
                    key={route.path}
                    to={route.path}
                    data-sidebar-link="true"
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'sidebar-item',
                      isActive ? 'sidebar-item-active' : 'sidebar-item-inactive'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span>{route.label}</span>
                  </Link>
                );
              })}
                </div>
              ))}
            </div>

            {/* Footer — current tenant + role (no privilege toggle) */}
            <div className="border-t border-[hsl(var(--color-border-premium))] px-4 py-3">
              <div className="text-xs font-medium text-foreground truncate">{user?.tenantName || 'Merchant'}</div>
              <div className="text-[11px] text-muted-foreground">{ROLE_LABELS[role] || role}</div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'flex flex-col premium-sidebar transition-all duration-300 relative h-screen overflow-hidden hidden lg:flex',
          sidebarCollapsed ? 'w-16' : 'w-[260px]'
        )}
      >
        {/* Logo Area */}
        <div className={cn('flex h-14 items-center border-b border-[hsl(var(--color-border-premium))]', sidebarCollapsed ? 'justify-center px-2' : 'px-4')}>
          <BrandLogo className="h-9 w-9" />
          {!sidebarCollapsed && (
            <span className="ml-3 font-semibold text-lg tracking-tight">
              <span className="gradient-text">OMSKing</span>
            </span>
          )}
        </div>

        {/* Navigation */}
        <div ref={desktopNavRef} className="flex-1 overflow-y-auto px-2 py-3">
          {Object.entries(filteredRoutes).map(([group, routes]) => (
            <div key={group} className="mb-2">
              {!sidebarCollapsed && (
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {groupLabels[group] || group}
                </div>
              )}
              {routes.map((route) => {
                const Icon = iconMap[route.icon] || Box;
                const isActive = location.pathname === route.path || (route.path !== '/' && location.pathname.startsWith(`${route.path}/`));
                
                return (
                  <Link
                    key={route.path}
                    to={route.path}
                    data-sidebar-link="true"
                    className={cn(
                      'sidebar-item',
                      isActive ? 'sidebar-item-active' : 'sidebar-item-inactive',
                      sidebarCollapsed && 'justify-center px-3'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {!sidebarCollapsed && <span>{route.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer — current tenant + role */}
        <div className="border-t border-[hsl(var(--color-border-premium))] px-4 py-3">
          {!sidebarCollapsed ? (
            <>
              <div className="text-xs font-medium text-foreground truncate">{user?.tenantName || 'Merchant'}</div>
              <div className="text-[11px] text-muted-foreground">{ROLE_LABELS[role] || role}</div>
            </>
          ) : (
            <div className="text-[10px] text-center text-muted-foreground">
              {role === ROLES.SUPER_ADMIN ? 'SA' : 'A'}
            </div>
          )}
        </div>

        {/* Collapse Toggle - Desktop Only */}
        <button
          onClick={toggleSidebar}
          className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[hsl(var(--color-card-bg))] border border-[hsl(var(--color-border-premium))] items-center justify-center hover:bg-[hsl(var(--color-muted))] transition-all shadow-lg z-10"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </aside>
    </>
  );
}

export default AdminSidebar;