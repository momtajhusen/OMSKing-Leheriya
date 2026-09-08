import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import NotFoundPage from '../pages/NotFoundPage';

// Lazy load layout components
const AuthLayout = lazy(() => import('../components/layout/AuthLayout'));
const AdminLayout = lazy(() => import('../components/layout/AdminLayout'));
const VendorLayout = lazy(() => import('../components/layout/VendorLayout'));

// Route definitions - single source of truth for sidebar and router
export const ROUTE_DEFS = {
  auth: [
    {
      path: '/auth/login',
      label: 'Login',
      component: lazy(() => import('../pages/auth/LoginPage')),
    },
    {
      path: '/auth/forgot-password',
      label: 'Forgot Password',
      component: lazy(() => import('../pages/auth/ForgotPasswordPage')),
    },
  ],
  admin: [
    {
      path: '/dashboard',
      label: 'Dashboard',
      icon: 'LayoutDashboard',
      group: 'Core Platform',
      component: lazy(() => import('../pages/admin/DashboardPage')),
    },
    {
      path: '/authentication',
      label: 'Authentication',
      icon: 'Shield',
      group: 'Core Platform',
      component: lazy(() => import('../pages/admin/AuthPage')),
    },
    {
      path: '/tenant-mgmt',
      label: 'Tenant/Merchant Mgmt',
      icon: 'Building2',
      group: 'Core Platform',
      component: lazy(() => import('../pages/admin/TenantMgmtPage')),
    },
    {
      path: '/users-roles',
      label: 'Users & Roles',
      icon: 'Users',
      group: 'Core Platform',
      component: lazy(() => import('../pages/admin/UsersRolesPage')),
    },
    {
      path: '/audit-logs',
      label: 'Audit Logs',
      icon: 'FileText',
      group: 'Core Platform',
      component: lazy(() => import('../pages/admin/AuditLogsPage')),
    },
    {
      path: '/notifications',
      label: 'Notifications',
      icon: 'Bell',
      group: 'Core Platform',
      component: lazy(() => import('../pages/admin/NotificationsPage')),
    },
    {
      path: '/integration-mgmt',
      label: 'Integration Mgmt',
      icon: 'Plug',
      group: 'Core Platform',
      component: lazy(() => import('../pages/admin/IntegrationManagementPage')),
    },
    {
      path: '/settings',
      label: 'Settings',
      icon: 'Settings',
      group: 'Core Platform',
      component: lazy(() => import('../pages/admin/SettingsPage')),
    },
    {
      path: '/products',
      label: 'Products',
      icon: 'Package',
      group: 'Catalog',
      component: lazy(() => import('../pages/admin/ProductsPage')),
    },
    {
      path: '/master-sku',
      label: 'Master SKU',
      icon: 'Barcode',
      group: 'Catalog',
      component: lazy(() => import('../pages/admin/MasterSkuPage')),
    },
    {
      path: '/sku-mapping',
      label: 'SKU Mapping',
      icon: 'GitCompare',
      group: 'Catalog',
      component: lazy(() => import('../pages/admin/SkuMappingPage')),
    },
    {
      path: '/inventory',
      label: 'Inventory',
      icon: 'Warehouse',
      group: 'Inventory & Storage',
      component: lazy(() => import('../pages/admin/InventoryPage')),
    },
    {
      path: '/warehouses',
      label: 'Warehouses',
      icon: 'Building',
      group: 'Inventory & Storage',
      component: lazy(() => import('../pages/admin/WarehousesPage')),
    },
    {
      path: '/orders',
      label: 'Orders',
      icon: 'ShoppingCart',
      group: 'Orders & Fulfilment',
      component: lazy(() => import('../pages/admin/OrdersPage')),
    },
    {
      path: '/fulfilment',
      label: 'Fulfilment',
      icon: 'Truck',
      group: 'Orders & Fulfilment',
      component: lazy(() => import('../pages/admin/FulfilmentPage')),
    },
    {
      path: '/vendors',
      label: 'Vendors',
      icon: 'Store',
      group: 'Orders & Fulfilment',
      component: lazy(() => import('../pages/admin/VendorsPage')),
    },
    {
      path: '/shipping',
      label: 'Shipping',
      icon: 'PackageCheck',
      group: 'Orders & Fulfilment',
      component: lazy(() => import('../pages/admin/ShippingPage')),
    },
    {
      path: '/returns',
      label: 'Returns',
      icon: 'RotateCcw',
      group: 'Reverse Logistics',
      component: lazy(() => import('../pages/admin/ReturnsPage')),
    },
    {
      path: '/rto',
      label: 'RTO',
      icon: 'ArrowDownLeft',
      group: 'Reverse Logistics',
      component: lazy(() => import('../pages/admin/RtoPage')),
    },
    {
      path: '/ndr',
      label: 'NDR',
      icon: 'AlertTriangle',
      group: 'Reverse Logistics',
      component: lazy(() => import('../pages/admin/NdrPage')),
    },
    {
      path: '/gst-invoice',
      label: 'GST Invoice',
      icon: 'FileSpreadsheet',
      group: 'Finance',
      component: lazy(() => import('../pages/admin/GstInvoicePage')),
    },
    {
      path: '/payment-reconciliation',
      label: 'Payment Reconciliation',
      icon: 'CreditCard',
      group: 'Finance',
      component: lazy(() => import('../pages/admin/PaymentReconciliationPage')),
    },
    {
      path: '/returns-refunds-reconciliation',
      label: 'Returns/Refunds Reconciliation',
      icon: 'RefreshCw',
      group: 'Finance',
      component: lazy(() => import('../pages/admin/ReturnsRefundsReconciliationPage')),
    },
    {
      path: '/reports',
      label: 'Reports',
      icon: 'BarChart3',
      group: 'Core Platform',
      component: lazy(() => import('../pages/admin/ReportsPage')),
    },
    {
      path: '/ui/showcase',
      label: 'UI Showcase',
      icon: 'Palette',
      group: 'Core Platform',
      component: lazy(() => import('../pages/admin/UiShowcasePage')),
    },
  ],
  vendor: [
    {
      path: '/vendor/dashboard',
      label: 'Dashboard',
      component: lazy(() => import('../pages/vendor/VendorDashboardPage')),
    },
    {
      path: '/vendor/orders',
      label: 'Orders',
      component: lazy(() => import('../pages/vendor/VendorOrdersPage')),
    },
    {
      path: '/vendor/products',
      label: 'Products',
      component: lazy(() => import('../pages/vendor/VendorProductsPage')),
    },
    {
      path: '/vendor/shipping',
      label: 'Shipping',
      component: lazy(() => import('../pages/vendor/VendorShippingPage')),
    },
    {
      path: '/vendor/returns',
      label: 'Returns',
      component: lazy(() => import('../pages/vendor/VendorReturnsPage')),
    },
    {
      path: '/vendor/settings',
      label: 'Settings',
      component: lazy(() => import('../pages/vendor/VendorSettingsPage')),
    },
  ],
};

// Loading component
function LoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-muted-foreground">Loading...</div>
    </div>
  );
}

// Create router configuration
const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/dashboard" replace />,
  },
  // Auth routes with layout wrapper
  {
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <AuthLayout />
      </Suspense>
    ),
    children: ROUTE_DEFS.auth.map((route) => ({
      path: route.path.replace('/auth/', ''),
      element: (
        <Suspense fallback={<LoadingFallback />}>
          <route.component />
        </Suspense>
      ),
    })),
  },
  // Admin routes with layout wrapper
  {
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <AdminLayout />
      </Suspense>
    ),
    children: ROUTE_DEFS.admin.map((route) => ({
      path: route.path,
      element: (
        <Suspense fallback={<LoadingFallback />}>
          <route.component />
        </Suspense>
      ),
    })),
  },
  // Vendor routes with layout wrapper
  {
    path: '/vendor',
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <VendorLayout />
      </Suspense>
    ),
    children: ROUTE_DEFS.vendor.map((route) => ({
      path: route.path.replace('/vendor/', ''),
      element: (
        <Suspense fallback={<LoadingFallback />}>
          <route.component />
        </Suspense>
      ),
    })),
  },
  // 404 catch-all
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);

export default router;