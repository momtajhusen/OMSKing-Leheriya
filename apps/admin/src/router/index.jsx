import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import NotFoundPage from '../pages/NotFoundPage';
import ProtectedRoute from '../components/ui/ProtectedRoute';
import PageLoader from '../components/ui/PageLoader';
import { TENANT_STAFF_ROLES } from '../constants/roles';

// Lazy load layout components
const AuthLayout = lazy(() => import('../components/layout/AuthLayout'));
const AdminLayout = lazy(() => import('../components/layout/AdminLayout'));
const VendorLayout = lazy(() => import('../components/layout/VendorLayout'));
const PublicLayout = lazy(() => import('../components/layout/PublicLayout'));
const PlatformLayout = lazy(() => import('../components/layout/PlatformLayout'));
const PlatformDashboardPage = lazy(() => import('../pages/platform/PlatformDashboardPage'));
const PlatformAuthPage = lazy(() => import('../pages/platform/PlatformAuthPage'));
const TenantMgmtPage = lazy(() => import('../pages/admin/TenantMgmtPage'));
const PlatformOpsPage = lazy(() => import('../pages/platform/PlatformOpsPage'));
const PlatformStaffPage = lazy(() => import('../pages/platform/PlatformStaffPage'));

// Route definitions - single source of truth for sidebar and router
export const ROUTE_DEFS = {
  public: [
    {
      path: '/',
      label: 'Home',
      component: lazy(() => import('../pages/public/HomePage')),
    },
    {
      path: '/about',
      label: 'About',
      component: lazy(() => import('../pages/public/AboutPage')),
    },
    {
      path: '/features',
      label: 'Features',
      component: lazy(() => import('../pages/public/FeaturesPage')),
    },
    {
      path: '/pricing',
      label: 'Pricing',
      component: lazy(() => import('../pages/public/PricingPage')),
    },
    {
      path: '/contact',
      label: 'Contact',
      component: lazy(() => import('../pages/public/ContactPage')),
    },
  ],
  auth: [
    {
      path: '/auth/login',
      label: 'Login',
      component: lazy(() => import('../pages/auth/LoginPage')),
    },
    {
      path: '/auth/register',
      label: 'Register',
      component: lazy(() => import('../pages/auth/RegisterPage')),
    },
    {
      path: '/auth/forgot-password',
      label: 'Forgot Password',
      component: lazy(() => import('../pages/auth/ForgotPasswordPage')),
    },
    {
      path: '/auth/reset-password',
      label: 'Reset Password',
      component: lazy(() => import('../pages/auth/ResetPasswordPage')),
    },
  ],
  admin: [
    {
      path: '/dashboard',
      label: 'Dashboard',
      icon: 'LayoutDashboard',
      group: 'Daily',
      component: lazy(() => import('../pages/admin/DashboardPage')),
    },
    {
      path: '/orders',
      label: 'Orders',
      icon: 'ShoppingCart',
      group: 'Daily',
      component: lazy(() => import('../pages/admin/OrdersPage')),
    },
    {
      path: '/fulfilment',
      label: 'Fulfilment',
      icon: 'Truck',
      group: 'Daily',
      component: lazy(() => import('../pages/admin/FulfilmentPage')),
    },
    {
      path: '/shipping',
      label: 'Shipping',
      icon: 'PackageCheck',
      group: 'Daily',
      component: lazy(() => import('../pages/admin/ShippingPage')),
    },
    {
      path: '/vendors',
      label: 'Vendors',
      icon: 'Store',
      group: 'Daily',
      component: lazy(() => import('../pages/admin/VendorsPage')),
    },
    {
      path: '/reports',
      label: 'Reports',
      icon: 'BarChart3',
      group: 'Daily',
      component: lazy(() => import('../pages/admin/ReportsPage')),
    },
    {
      path: '/inventory',
      label: 'Inventory',
      icon: 'Warehouse',
      group: 'Stock',
      component: lazy(() => import('../pages/admin/InventoryPage')),
    },
    {
      path: '/warehouses',
      label: 'Warehouses',
      icon: 'Building',
      group: 'Stock',
      component: lazy(() => import('../pages/admin/WarehousesPage')),
    },
    {
      path: '/returns',
      label: 'Returns',
      icon: 'RotateCcw',
      group: 'Returns',
      component: lazy(() => import('../pages/admin/ReturnsPage')),
    },
    {
      path: '/rto',
      label: 'RTO',
      icon: 'ArrowDownLeft',
      group: 'Returns',
      component: lazy(() => import('../pages/admin/RtoPage')),
    },
    {
      path: '/ndr',
      label: 'NDR',
      icon: 'AlertTriangle',
      group: 'Returns',
      component: lazy(() => import('../pages/admin/NdrPage')),
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
      path: '/import',
      label: 'Bulk import',
      icon: 'Upload',
      group: 'Catalog',
      component: lazy(() => import('../pages/admin/ProductImportPage')),
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
      label: 'Payments',
      icon: 'CreditCard',
      group: 'Finance',
      component: lazy(() => import('../pages/admin/PaymentReconciliationPage')),
    },
    {
      path: '/returns-refunds-reconciliation',
      label: 'Refunds',
      icon: 'RefreshCw',
      group: 'Finance',
      component: lazy(() => import('../pages/admin/ReturnsRefundsReconciliationPage')),
    },
    {
      path: '/channels',
      label: 'Channels',
      icon: 'Radio',
      group: 'Setup',
      component: lazy(() => import('../pages/admin/ChannelsPage')),
    },
    {
      path: '/integrations',
      label: 'Integrations',
      icon: 'Plug',
      group: 'Setup',
      component: lazy(() => import('../pages/admin/IntegrationManagementPage')),
    },
    {
      path: '/webhooks',
      label: 'Webhooks',
      icon: 'Webhook',
      group: 'Setup',
      component: lazy(() => import('../pages/admin/WebhooksPage')),
    },
    {
      path: '/notifications',
      label: 'Notifications',
      icon: 'Bell',
      group: 'Setup',
      component: lazy(() => import('../pages/admin/NotificationsPage')),
    },
    {
      path: '/settings',
      label: 'Settings',
      icon: 'Settings',
      group: 'Admin',
      component: lazy(() => import('../pages/admin/SettingsPage')),
    },
    {
      path: '/users-roles',
      label: 'Users & Roles',
      icon: 'Users',
      group: 'Admin',
      component: lazy(() => import('../pages/admin/UsersRolesPage')),
    },
    {
      path: '/audit-logs',
      label: 'Audit Logs',
      icon: 'FileText',
      group: 'Admin',
      component: lazy(() => import('../pages/admin/AuditLogsPage')),
    },
    {
      path: '/authentication',
      label: 'Authentication',
      icon: 'Shield',
      group: 'Admin',
      component: lazy(() => import('../pages/admin/AuthPage')),
    },
    {
      path: '/ui/showcase',
      label: 'UI Showcase',
      icon: 'Palette',
      group: 'Admin',
      component: lazy(() => import('../pages/admin/UiShowcasePage')),
    },
  ],
  vendor: [
    {
      path: '/vendor/orders',
      label: 'Orders',
      component: lazy(() => import('../pages/vendor/VendorOrdersPage')),
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
      path: '/vendor/products',
      label: 'Products',
      component: lazy(() => import('../pages/vendor/VendorProductsPage')),
    },
    {
      path: '/vendor/dashboard',
      label: 'Dashboard',
      component: lazy(() => import('../pages/vendor/VendorDashboardPage')),
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
  return <PageLoader label="Loading…" />;
}

function ScreenLoader() {
  return <PageLoader fullscreen label="Loading OMSKing…" />;
}

// Create router configuration
const router = createBrowserRouter([
  {
    element: (
      <Suspense fallback={<ScreenLoader />}>
        <PublicLayout />
      </Suspense>
    ),
    children: ROUTE_DEFS.public.map((route) => ({
      index: route.path === '/',
      path: route.path === '/' ? undefined : route.path.replace(/^\//, ''),
      element: (
        <Suspense fallback={<LoadingFallback />}>
          <route.component />
        </Suspense>
      ),
    })),
  },
  // Auth routes with layout wrapper
  {
    path: '/auth',
    element: (
      <Suspense fallback={<ScreenLoader />}>
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
  // SaaS platform control — Platform Admin only
  {
    path: '/platform',
    element: (
      <ProtectedRoute requiredRoles={['platform_admin']}>
        <Suspense fallback={<ScreenLoader />}>
          <PlatformLayout />
        </Suspense>
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PlatformDashboardPage />
          </Suspense>
        ),
      },
      {
        path: 'tenants',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <TenantMgmtPage />
          </Suspense>
        ),
      },
      {
        path: 'auth',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PlatformAuthPage />
          </Suspense>
        ),
      },
      {
        path: 'health',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PlatformOpsPage />
          </Suspense>
        ),
      },
      {
        path: 'jobs',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PlatformOpsPage />
          </Suspense>
        ),
      },
      {
        path: 'logs',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PlatformOpsPage />
          </Suspense>
        ),
      },
      {
        path: 'settings',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PlatformOpsPage />
          </Suspense>
        ),
      },
      {
        path: 'plans',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PlatformOpsPage />
          </Suspense>
        ),
      },
      {
        path: 'users',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PlatformStaffPage />
          </Suspense>
        ),
      },
    ],
  },
  // Merchant OMS — Super Admin and Admin
  {
    element: (
      <ProtectedRoute requiredRoles={TENANT_STAFF_ROLES}>
        <Suspense fallback={<ScreenLoader />}>
          <AdminLayout />
        </Suspense>
      </ProtectedRoute>
    ),
    children: [
      ...ROUTE_DEFS.admin.map((route) => ({
        path: route.path,
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <route.component />
          </Suspense>
        ),
      })),
      { path: '/integration-mgmt', element: <Navigate to="/integrations" replace /> },
      { path: '/tenant-mgmt', element: <Navigate to="/platform/tenants" replace /> },
    ],
  },
  // Vendor routes with layout wrapper and protection
  {
    path: '/vendor',
    element: (
      <ProtectedRoute requiredRole="vendor">
        <Suspense fallback={<ScreenLoader />}>
          <VendorLayout />
        </Suspense>
      </ProtectedRoute>
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