# OMSKing Phase 1 — UI Foundation & Design System — Implementation Plan

## Task 1: Install dependencies & configure Tailwind + PostCSS
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Add to `apps/admin/package.json` devDependencies: `tailwindcss`, `postcss`, `autoprefixer`, `tailwindcss-animate`, `@tailwindcss/typography`.
  - Add to `apps/admin/package.json` dependencies: `lucide-react`, `react-router-dom` (already there), `zustand`, `clsx`, `tailwind-merge`, `dayjs`, `recharts`, `react-hot-toast`, `react-hook-form`, `@hookform/resolvers`, `zod`, `framer-motion`.
  - Run `pnpm install` from OMSKing root.
  - Create `apps/admin/tailwind.config.js` using shadcn-ui-style tokens: import colors from CSS vars (`hsl(var(--color-*))`), configure `content`, `darkMode: 'class'`, plugin list, custom boxShadow, borderRadius, fontFamily, screens.
  - Create `apps/admin/postcss.config.js` with tailwindcss + autoprefixer plugins.
  - Rewrite `apps/admin/src/index.css` with `@tailwind` base/components/utilities; define `:root` (light) and `.dark` CSS variables for all 16 semantic colors (background, foreground, card, card-fg, popover, popover-fg, primary, primary-fg, secondary, secondary-fg, muted, muted-fg, accent, accent-fg, destructive, destructive-fg, border, input, ring); brand palette Primary = Navy #0F172A / accent #1E3A8A / Secondary = Amber #D97706; smooth base transitions; scrollbar styling; selection colors.
  - Add Google Fonts link for **Inter** (sans-serif) to `index.html` `<head>` (no font files local).
  - Update `README.md` top header: Current Phase line changes to `Current Phase: 1 — UI Foundation & Design System (In Progress)`.
- **Acceptance Criteria Addressed**: AC-1 (build must succeed), AC-2 (CSS tokens & dark mode class strategy), AC-9 (folder layout, build clean).
- **Test Requirements**:
  - `rule` TR-1.1: `cd apps/admin && pnpm run build` exits code 0 AFTER task 1 completes. Evidence: terminal output of `pnpm --filter @omsking/admin run build 2>&1 | tail -20`.
  - `rule` TR-1.2: `grep -c "darkMode: 'class'" apps/admin/tailwind.config.js` returns ≥1 & `grep -c "tailwindcss-animate" apps/admin/tailwind.config.js` returns ≥1. Evidence: grep terminal output.
  - `rule` TR-1.3: `apps/admin/src/index.css` contains both `:root { --color-primary:` AND `.dark { --color-primary:` blocks with different values. Evidence: content of index.css lines.
  - `rule` TR-1.4: Both `apps/admin/tailwind.config.js` and `apps/admin/postcss.config.js` files exist and export valid JS configs. Evidence: `ls -la` of apps/admin/ showing the two files.
- **Notes**: Install deps first before any other task — it's the root of every downstream. Recharts is charts, framer-motion enables page transitions, zustand for theme+ui state, clsx+twMerge for className merging.

## Task 2: Theme Engine, UI state store, global providers, router entry
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - `apps/admin/src/lib/utils.js`: Export `cn = (...inputs) => twMerge(clsx(inputs))` — reusable className helper.
  - `apps/admin/src/stores/themeStore.js`: Zustand store with state `{theme: 'light'|'dark'}`. On init reads from localStorage key `'oms-theme'` or `matchMedia('(prefers-color-scheme: dark)')`. Actions: `toggleTheme()`, `setTheme(value)` — both sync `document.documentElement.classList.toggle('dark')` and write localStorage.
  - `apps/admin/src/stores/uiStore.js`: Zustand store for shell state: `sidebarCollapsed: bool` (default false), `activeRole: 'super_admin'|'admin'|'vendor'` (default 'super_admin' for visual testing), `mobileOpen: bool`, `breadcrumbs: []`. Actions: `toggleSidebar()`, `setActiveRole(role)`, etc.
  - `apps/admin/src/providers/RootProviders.jsx`: Wraps `children` with Theme application effect (applies dark class on mount) + `react-hot-toast`'s `<Toaster>` configured with position top-right, 2800ms duration, custom theme-aware styles, correct bezier easing transitions.
  - `apps/admin/src/pages/NotFoundPage.jsx`: Pretty 404 page with icons + back-to-dashboard button.
  - `apps/admin/src/router/index.jsx`: React Router v6 `createBrowserRouter` config with three route groups:
    - `_auth` at `/auth/*` → placeholder layout `<AuthLayout>` + routes `login`, `forgot-password`
    - `_admin` at `/*` → `<AdminLayout>` + dashboard, all 23 module routes (see task 6), `/ui/showcase` (component library page)
    - `_vendor` at `/vendor/*` → `<VendorLayout>` + vendor/dashboard, vendor/orders, vendor/products, vendor/shipping, vendor/returns, vendor/settings
    - `*` → NotFoundPage
  - Also exports `ROUTE_DEFS` DRY object used both by sidebar and router (single source of truth).
  - Rewrite `main.jsx` to use `<RouterProvider>` instead of `<BrowserRouter><App /></BrowserRouter>`; wrap providers around RouterProvider.
  - Rewrite `App.jsx` to be the default shell/layout router (routing logic moved to router file).
  - Create `apps/admin/src/hooks/usePageTransition.js`: Returns props (style + ref) to pass to AnimatePresence/page wrapper for standardized fade/slide transition.
- **Acceptance Criteria Addressed**: AC-2 (theme provider & localStorage persistence + prefers-color-scheme), AC-3 (routing for all module routes), AC-6 (page transition hook with easing), AC-9 (clean folder structure: `stores/`, `providers/`, `router/`, `hooks/`, `lib/`).
- **Test Requirements**:
  - `rule` TR-2.1: After boot, `localStorage.getItem('oms-theme')` returns `'dark' or 'light'` and `document.documentElement.classList.contains('dark')` correctly reflects it, then toggling via zustand action `toggleTheme()` flips both. Evidence: Browser evaluate script that calls actions & reads values.
  - `rule` TR-2.2: `router/index.jsx` defines ≥ 28 routes total (auth:2 + admin:~25 + vendor:6 + 404 = ≥33). Evidence: count of `path:` occurrences in the router config file.
  - `rule` TR-2.3: Navigate to URL `/this-route-does-not-exist-xyz` — renders NotFoundPage with "404" text and "Back to dashboard" button. Evidence: Browser DOM snapshot.
  - `rubric` TR-2.4: Folder layout; scale 1-5; 1=no structure, 3=some, 5=5 folders exist (lib, stores, providers, router, hooks). Threshold ≥4. Evidence: `ls -d apps/admin/src/{lib,stores,providers,router,hooks} 2>&1`.
- **Notes**: `framer-motion` `AnimatePresence` wraps routes in layout components (task 3). Route definitions DRY — sidebar and router read from same array to avoid duplication.

## Task 3: Design System Primitives — 18+ shared UI components
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2 (needs `cn()`, zustand optional)
- **Description**:
  - Build each component under `apps/admin/src/components/ui/` as a named component with forwardRef (where applicable), variants using `clsx`-based conditional classes. All accept `className` override merged with `cn()`.
  - Required components (18):
    1. **Button**: `variant: default/destructive/outline/secondary/ghost/link`; `size: sm/default/lg/icon`; loading state; disabled state.
    2. **Input**: Label (optional), icon-left/right slots, error state (red ring + helper text), disabled, placeholder. Export also `FormField` wrapper using label + input + error.
    3. **Textarea**: Same variants, resize option.
    4. **Select**: Controlled select with chevron icon, disabled, placeholder. (Native `<select>` wrapped in styled div — sufficient for Phase 1; no headless UI yet.)
    5. **Card**: 4-piece compound: `<Card>`, `<CardHeader>`, `<CardTitle>`, `<CardDescription>`, `<CardContent>`, `<CardFooter>`.
    6. **Badge**: `variant: default/secondary/destructive/outline` (for status tags).
    7. **Tag** / Chip: small inline chips with close `×` button (for filter tags).
    8. **Avatar**: `<Avatar>` with `<AvatarImage src>` fallback `<AvatarFallback name="AA" />` with deterministic gradient based on initials.
    9. **Table**: Compound `<Table>`, `<TableHeader>`, `<TableBody>`, `<TableFooter>`, `<TableRow>`, `<TableHead>`, `<TableCell>`, `<TableCaption>`. Sticky header optional prop, zebra stripes via CSS.
    10. **Tabs**: `<Tabs>`, `<TabsList>`, `<TabsTrigger value>`, `<TabsContent value>`. CSS class-based active with primary underline.
    11. **Modal** (Dialog): `<Dialog open={bool} onOpenChange={setter}>` with overlay, content, close, header, title, description, footer. Focus trap not required Phase 1.
    12. **Drawer**: Right-side sliding drawer (for order/sku detail views). Uses framer-motion slide, same bezier easing.
    13. **DropdownMenu**: `<DropdownMenu>` trigger + items. Click-outside-to-close. Used in Header avatar menu, column headers actions.
    14. **Toast helper**: `toast.success("msg") / toast.error("msg") / toast.info("msg")` wrapper functions.
    15. **Loader / Spinner**: `<Loader />` (spinner icon), `<Skeleton className="h-8 w-8 rounded-full" />` shimmer component.
    16. **EmptyState**: `<EmptyState icon={<BoxIcon />} title="No data" description="..." action={<Button />} />`.
    17. **Alert**: `<Alert variant=default|destructive>` + `<AlertTitle>` `<AlertDescription>`.
    18. **Breadcrumbs**: `<Breadcrumbs items={[{label,href?}]} />`.
    19. **KpiCard**: `<KpiCard label="Revenue" value="₹14,34,500" delta={+23.5} icon={<TrendingUp />} />` — compound variant based on AC-5.
  - Build route `/ui/showcase` (`pages/admin/UiShowcasePage.jsx`) that mounts every component in both default + alternate variant states for visual QA. Include Button variants grid, Input with all states, Table with zebra rows, Tabs with 3 tabs content, Modal+Drawer demo buttons, Toast triggers.
- **Acceptance Criteria Addressed**: AC-7 (18+ primitives, variants, theme), AC-2 (component theme), AC-5 (KpiCard primitive).
- **Test Requirements**:
  - `rule` TR-3.1: `ls apps/admin/src/components/ui/*.jsx | wc -l` returns ≥18 unique component files. Evidence: ls + count.
  - `rule` TR-3.2: Visiting `/ui/showcase` renders each primitive with no React uncaught errors, no warnings, and changing theme (Task 2 store) keeps all text legible. Evidence: snapshot + console messages list = 0 errors.
  - `rule` TR-3.3: Button variants `primary` (default) + `destructive` both produce different computed background colors, disabled state has `opacity-50 cursor-not-allowed`. Evidence: eval `getComputedStyle(document.querySelectorAll('button')[0]).backgroundColor` for each.
  - `rule` TR-3.4: Input renders error state correctly when prop passed — red border + help text exists. Evidence: DOM snapshot of showcase with `error` variant.
  - `rubric` TR-3.5: Component API consistency & composability. Scale 1-5; 1=many inconsistent props, 3=some inconsistency, 5=every component: (a) accepts `className` merged via cn(), (b) forwardRef for form elements, (c) variants as conditional class strings not ternary soup, (d) compound where applicable. Threshold ≥4. Evidence: spot-check code of 5 random component files.

## Task 4: Admin Layout Shell — Sidebar, Header, Content, independent scroll
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3 (needs primitives), Task 2 (zustand uiStore & router)
- **Description**:
  - `components/layout/AdminSidebar.jsx`: Collapsible sidebar, width 256px (collapsed 64px). Contains: (1) Brand logo block "OMSKing Leheriya Creations" with navy/amber badge. (2) 6 grouped sections of navigation (per FR-2): Core Platform (Dashboard, Authentication, Tenant/Mgmt, Users & Roles, Audit Logs, Notifications, Integration Mgmt, Settings), Catalog (Products, Master SKU, SKU Mapping), Inventory & Storage (Inventory, Warehouses), Orders & Fulfilment (Orders, Fulfilment, Vendors, Shipping), Reverse Logistics (Returns, RTO, NDR), Finance (GST Invoice, Payment Reconciliation, Returns/Refunds Reconciliation). Each item uses `lucide-react` icons. Active item = primary bg/fg; inactive = muted fg; hover = secondary bg. Badge counts optional (`New`, `Beta`). Bottom section role-switcher demo (Super Admin / Admin / Vendor).
  - `components/layout/AdminHeader.jsx`: Sticky 64px top bar. Left side: sidebar toggle button + Breadcrumbs component. Center: quick search Input placeholder (non-functional). Right side: (1) notifications bell DropdownMenu with 3 mock notification items (badge with count=5), (2) theme toggle Sun/Moon icon Button (uses themeStore), (3) Avatar DropdownMenu (name "Momtaj Husen", email "thecodersalpha@gmail.com") → items: Profile, Switch Role (Super Admin / Admin / Vendor), Settings, Logout (demo toast only).
  - `components/layout/AdminLayout.jsx`: Full shell. Uses CSS grid `grid-cols-[auto_1fr]`, sidebar column auto-width, header row. Content pane has `overflow-y-auto` with independent scrolling. Wraps children outlet with `<AnimatePresence mode="wait">` + framer-motion motion.div variants (fade + translateY 8px slide with bezier easing). Transition duration: 160ms. Persists scroll per-tab independent of other panes. Contains breadcrumb injection from matched route handle.
  - `<main>` content max-width 100%, padding: page-level `p-6`, inner grid gutters 24px. Page header title block (module name + description + primary action Button) repeated across pages.
  - Responsive: mobile (<1024px) sidebar becomes full overlay via `mobileOpen` state from uiStore. Below desktop sidebar toggle only. (Mobile perfect is Non-goal but shouldn't completely break.)
- **Acceptance Criteria Addressed**: AC-2 (theme toggle), AC-3 (23 module sidebar + layout), AC-6 (page transitions), AC-9 (folder layout).
- **Test Requirements**:
  - `rule` TR-4.1: Nav links count in sidebar = 23 (excluding Dashboard? No: Dashboard included → total 23 module links = Dashboard + 22 others). Evidence: DOM `document.querySelectorAll('[data-sidebar-link]').length >= 23`.
  - `rule` TR-4.2: Sidebar toggle button → after click uiStore.sidebarCollapsed flips → sidebar computed width changes by ≥100px (256→64 or vv). Evidence: Browser eval.
  - `rule` TR-4.3: Header theme button toggles theme correctly (already tested AC-2 — this ensures header button works end-to-end). Evidence: click theme toggle → `document.documentElement.classList.toggle('dark')`.
  - `rule` TR-4.4: Main content pane scrolls while header & sidebar remain fixed. Evidence: DOM scrolling + layout snapshot (header sticky visual).
  - `rule` TR-4.5: Route change Dashboard → Products → content area shows animated enter (opacity goes 0→1 with translate). Evidence: DevTools CSS animated `transform: translateY(0px)` after transition.
  - `rubric` TR-4.6: Layout look & feel professional admin. Scale 1-5. 1=broke, 3=okay, 5=premium Blinkit/Instamart-style compact multi-pane. Threshold ≥4. Evidence: Full-page screenshot of `/dashboard`.

## Task 5: Vendor Layout Shell — Excel-style simpler UI
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 3, Task 4
- **Description**:
  - `components/layout/VendorSidebar.jsx`: Compact sidebar (fixed width, no collapse) with logo block + 5 nav items: Dashboard, Orders, Products, Shipping, Returns, Settings.
  - `components/layout/VendorHeader.jsx`: Sticky 56px header. Logo title "Vendor Console · Leheriya Creations". Right: theme toggle + avatar (Vendor name "Sandeep Textiles" — demo vendor).
  - `components/layout/VendorLayout.jsx`: Excel-style approach: `text-[13px] leading-tight` body font; tables use compact row height `h-8`; shadows minimal; cards with only 1px border (no elevation / no large gradient accents). Primary buttons keep brand navy but slightly toned down. High information density. Content pane `p-4` instead of `p-6`.
  - Page wrapper applies standard transition.
- **Acceptance Criteria Addressed**: AC-4 (vendor shell Excel-style, correct module set).
- **Test Requirements**:
  - `rule` TR-5.1: Visiting `/vendor/orders` shows only ≤6 sidebar items. Evidence: DOM selector count of sidebar links.
  - `rule` TR-5.2: Vendor table body row computed height ≤ 34px (compact). Evidence: eval `getComputedStyle(firstRow).height` of vendor orders table body row.
  - `rule` TR-5.3: Vendor layout body base font-size ≤ 13px (text-sm = 14px is too large; use `text-[13px]` or `text-xs` where appropriate). Evidence: eval font-size.
  - `rubric` TR-5.4: Density vs Admin side-by-side comparison — Vendor visibly denser & less card-heavy than Admin. Scale 1-5; threshold ≥4. Evidence: side-by-side screenshots.

## Task 6: All 23 Admin Module Pages with realistic mock data
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3 (all primitives), Task 4 (AdminLayout), Task 10 (mocks data — mocks done in parallel with pages, task 10 runs first)
- **Description**:
  - Create mocks FIRST using Task 10 fixture module.
  - Each Admin page under `apps/admin/src/pages/admin/`:
    - Page header = `<div><h1>{title}</h1><p>{description from module list}</p></div>` plus 1–2 primary CTAs (e.g. "Add Product" button).
    - Minimum content: 2+ `<KpiCard>` statistic cards. 1+ `<Tabs>` tab group (≥2 tabs). 1+ `<Table>` with 5-15 rows of mock data imported from Task 10 fixtures.
  - Page roster (23 pages + Dashboard already counted above = 24? Actually: Dashboard is #3 in module list; the 23 total count covers modules per README — create exactly one page per module):
    1. `DashboardPage.jsx` — AC-5 content (see separate Task 8)
    2. `AuthPage.jsx` — show user list (mocked), password-reset request list — use `<Tabs>` with: Users, Sessions, Password Resets, API Keys
    3. `TenantMgmtPage.jsx` — Tenant table: Leheriya Creations (active), Demo Tenant 2 (trial), etc.
    4. `UsersRolesPage.jsx` — Users & Roles: two tabs. Users table, Roles with permission matrix (from Phase 0 RBAC blueprint; render static rows of role × permission checkmarks)
    5. `AuditLogsPage.jsx` — Time-series table: who/action/timestamp/IP/before-after JSON snippets
    6. `NotificationsPage.jsx` — Notification list + settings toggles per event (Telegram, Email, WhatsApp checkboxes table).
    7. `IntegrationManagementPage.jsx` — Channel cards (Shopify, Amazon, Myntra) each with "Connected" badge, last sync time, failed jobs count, Retry button.
    8. `SettingsPage.jsx` — FR-12: 5 tabs (Company Details, Channel Connections, Courier Settings, Tax & GST, API Credentials). Use real React Hook Form + Zod validation on Company Details tab (form fields: company name, GSTIN, PAN, Address (City, District — NO country), support email, support phone, logo upload placeholder).
    9. `ProductsPage.jsx` — Catalog browser: filters sidebar mock (2 columns), product table with SKU/Image/Name/HSN/GST %/Price/Status/Actions.
    10. `MasterSkuPage.jsx` — Master SKU table: internal SKU code, variant attrs, product link, stock, # channel mappings.
    11. `SkuMappingPage.jsx` — Master → Channel mapping table with sync status badges (Synced/Pending/Error).
    12. `InventoryPage.jsx` — Inventory by warehouse: 4 KPI cards (total stock, reserved, available, stock value), warehouse tabs, stock ledger table (date/type/qty delta/balance/note).
    13. `WarehousesPage.jsx` — List cards + table of warehouses: WH-001 Physical, WH-002 Virtual Shopify, etc. with location (City + District).
    14. `OrdersPage.jsx` — All Orders table + 7 status tabs (All, Pending, Processing, Awaiting Shipment, Shipped, Delivered, Exceptions). Each row shows order id, channel badge, customer, items, qty, value, status badge, AWB, actions. (Drawer opens on row click for detail)
    15. `FulfilmentPage.jsx` — 3 tabs (Stock Available → Pack & Ship, Stock Unavailable → Vendor Routing, On Hold). Queue tables per tab.
    16. `VendorsPage.jsx` — Vendor cards + vendor list table with assigned orders count, rating, status, Telegram group badge.
    17. `ShippingPage.jsx` — AWB generation queue + manifests + shipping status table. Action buttons: Generate Label, Cancel, Download Manifest.
    18. `ReturnsPage.jsx` — Return requests table with status badges, QC flags, refund/exchange radio.
    19. `RtoPage.jsx` — RTO tracking table: return-to-origin status, receipt date, QC result (restock/reject).
    20. `NdrPage.jsx` — NDR (Non-Delivery Report) table: failed reason, attempts, re-attempt schedule, escalation status.
    21. `GstInvoicePage.jsx` — Invoice table: invoice no, date, order, taxable value, IGST/CGST/SGST, total, action buttons (Print/Download/Email). HSN tax summary KPI cards.
    22. `PaymentReconciliationPage.jsx` — Upload controls (upload Amazon/Myntra settlement file), reconciled vs mismatched tables with flags.
    23. `ReturnsRefundsReconciliationPage.jsx` — Refund vs expected adjustment matching table with mismatch badges.
- **Pages are skeleton UI with mock data — NO backend calls.**
- Every `<TableRow>` uses a **list→detail hero transition** via Drawer component from Task 3: click a row → opens Drawer from right with full item view.
- All tables support hover highlight.
- **Acceptance Criteria Addressed**: AC-3 (non-blank pages for all 23 module routes), FR-5 (per page min content), FR-12 (Settings with tabs + form), FR-13 (Reports — create separate Reports module route): Wait, 23 modules don't include Reports standalone (Reports is part of Dashboard/Reports page from Phase 1 roadmap "skeleton pages for Dashboard, Orders, ..., Settings, Reports"). Add page `ReportsPage.jsx` with the 6 tabs from FR-13.
- Add ReportsPage as an extra (24th page if we're strict, but since we listed 23 modules — treat Reports inside Dashboard OR add `/reports` route and include it. Phase 1 roadmap explicitly lists it. Add it to Core Platform sidebar group under Dashboard.
- **Test Requirements**:
  - `rule` TR-6.1: 23 routes (plus Dashboard counted in 23 total) each render with: an H1 heading matching the module name, ≥1 `<Card>` rendered, ≥1 `<Table>` component with ≥5 `<tbody><tr>` rows (excluding header). Evidence: Automated eval: for each path in `ROUTE_DEFS.adminPaths`, navigate, count elements, check assertions — then produce a summary.
  - `rule` TR-6.2: Settings Company Tab — React Hook Form renders a form with at least 6 fields; invalid submission (e.g. empty GSTIN) shows Zod errors; valid submission triggers `toast.success("Saved")`. Evidence: Browser interaction + console.
  - `rule` TR-6.3: Orders page row click opens `<Drawer>` showing order id in a detail view. Evidence: DOM snapshot after click.
  - `rule` TR-6.4: Reports page renders all 6 tabs and each tab contains at least 1 chart or table component. Evidence: Click all 6 tabs → DOM count per tab ≥1 (chart or table).
  - `rubric` TR-6.5: Per-page information density & visual polish. Scale 1-5. 1=all pages empty, 3=pages satisfy TR-6.1 minima only, 5=each page has additional thoughtful content (filters bar, proper tab structure, CTA buttons, Drawer, stat cards, icons, color-coded badges), no page looks "boilerplate". Threshold ≥4. Evidence: Spot screenshots of 5 random pages.

## Task 7: Vendor Pages — Dashboard, Orders, Products, Shipping, Returns, Settings
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 5 (VendorLayout), Task 10 (mocks — use same fixture data but filtered to single vendor "Sandeep Textiles")
- **Description**:
  - Pages under `apps/admin/src/pages/vendor/`:
    1. `VendorDashboardPage.jsx` — simple stats: Assigned Orders (total, pending, shipped, returned), Revenue share, Top items, Shipments today.
    2. `VendorOrdersPage.jsx` — Excel-style dense table of assigned orders only; accept/reject action buttons, dispatch status, simple bulk update input (Excel-style edit cells feel).
    3. `VendorProductsPage.jsx` — Assigned product catalog table (compact).
    4. `VendorShippingPage.jsx` — Bulk AWB tracking number input area, paste 5 at once, mock table.
    5. `VendorReturnsPage.jsx` — Returns QC table, accept-restock/reject.
    6. `VendorSettingsPage.jsx` — Vendor profile + Telegram group link + bank a/c placeholder form.
- Vendor uses Excel-style compact rows everywhere; no big card shadows; dense fonts. Use same fixture data but filter by vendor.
- **Acceptance Criteria Addressed**: AC-4 (vendor module set density).
- **Test Requirements**:
  - `rule` TR-7.1: Vendor routes `/vendor/{dashboard,orders,products,shipping,returns,settings}` all render with page title + ≥1 table ≥5 rows. Evidence: route-nav eval assertions.
  - `rule` TR-7.2: Vendor Orders Excel-style bulk input area exists; entering "AWB1, AWB2, AWB3" in bulk tracking input box → after pressing Apply, first 3 rows' AWB column cell updates to these values (mock state). Evidence: before/after DOM state.
  - `rubric` TR-7.3: Vendor Orders denseness (same rubric as TR-5.4). Threshold ≥4.

## Task 8: Dashboard — KPIs, Charts, Low-stock & Recent tables
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3 (KpiCard, Table, cards), Task 10 (dashboard time series fixture), installed `recharts` (Task 1)
- **Description**:
  - DashboardPage specific:
    - **Top row — 6 KpiCard**: (1) Revenue (₹ + delta), (2) Orders (count + delta), (3) Fulfillment Rate (%), (4) Return Rate (%), (5) RTO Rate (%), (6) Avg Shipment Days.
    - **Charts row — 3 charts via Recharts**:
      (a) LineChart — Orders trend by day, last 14 days (x=date, y=orders). Stack Shopify/Amazon/Myntra as multi-line.
      (b) BarChart — Revenue by channel (3 bars: Shopify/Amazon/Myntra, current month).
      (c) PieChart / DonutChart — Order Status distribution: Pending/Processing/Shipped/Delivered/Returned.
    - **3-column bottom row — 2 Tables + 1 Activity feed**:
      (a) Left column: Low Stock Products Table (Product, SKU, Stock, Reorder Point, Status Badge, Action "Reorder").
      (b) Middle column: Recent Orders Table (Order ID, Customer, Channel, Qty, Value, Status, Action drawer-open).
      (c) Right column: Recent Activity (timeline) — shipments dispatched, returns approved, SKUs created, payments settled — use staggered framer-motion entry.
    - All components render **regardless of theme** (recharts SVG stroke colors bound to CSS tokens via style).
  - Dashboard grid: `grid-cols-12 gap-6` typical admin layout.
- **Acceptance Criteria Addressed**: AC-5 (≥6 KPI cards, ≥3 charts, ≥2 tables).
- **Test Requirements**:
  - `rule` TR-8.1: Dashboard DOM selector `[data-kpi-card] count === 6`. Evidence: eval.
  - `rule` TR-8.2: 3 `<svg>` chart nodes rendered from recharts (can nest, check that Recharts classes like `.recharts-line-chart` exist count ≥3). Evidence: eval.
  - `rule` TR-8.3: ≥2 `<table>` elements rendered & tbody rows ≥5 each. Evidence: eval.
  - `rubric` TR-8.4: Visual layout & information richness. Scale 1-5; threshold ≥4. Evidence: full-page screenshot light + dark.

## Task 9: Auth placeholder pages (Login + Forgot Password), AuthLayout
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 3 (Button, Input, Card, Alert), Task 2 (router)
- **Description**:
  - `components/layout/AuthLayout.jsx`: Centered layout with logo block and L/R split on desktop (left = brand gradient panel with OMSKing feature highlights + mock testimonial, right = centered card with form).
  - `pages/auth/LoginPage.jsx`: React Hook Form + Zod schema (email + password required, email valid format, min 8 char password). Demo links:
    - "Continue as Demo Super Admin" — button. On click: stores demo flag `demo-role=super_admin` in localStorage → toast.success("Demo role active") → navigate `/dashboard`.
    - "Continue as Demo Vendor" → sets `demo-role=vendor` → toast → navigate `/vendor/dashboard`.
  - `pages/auth/ForgotPasswordPage.jsx`: Form (email) → success alert mock.
- **Acceptance Criteria Addressed**: FR-9 (auth routes placeholder, demo login simulate role switch for visual testing).
- **Test Requirements**:
  - `rule` TR-9.1: Visiting `/auth/login` shows Login Card with email + password inputs + 2 demo continue buttons (Super Admin / Vendor). Evidence: DOM.
  - `rule` TR-9.2: Empty submit → shows 2 errors (email required, password required). Enter invalid `abc` → email invalid error, password length error. Evidence: DOM of error text after submit.
  - `rule` TR-9.3: Click Continue as Demo Vendor → 1.5s later URL path is `/vendor/dashboard` (demo flag written). Evidence: eval `location.pathname + localStorage.getItem('demo-role')` after click.
  - `rubric` TR-9.4: Login page polish — split layout beautiful in both themes. Scale 1-5; threshold ≥4. Evidence: screenshot.

## Task 10: Mock Fixtures — OMS domain-aware Indian-market data
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 (only dayjs install needed; can run as soon as Task 1 installs deps — actually fixtures are pure JS so runs parallel with Task 2)
- **Description**:
  - Create `apps/admin/src/mocks/index.js` re-exporting all fixtures.
  - Each fixture file under mocks/. Required fixtures (14):
    1. `orders.js`: 30 orders with mix statuses across channels, customers with Indian names (Rahul Sharma, Priya Patel), locations (Jaipur, Mumbai, Delhi — city + district), AWB codes, Delhivery/Bluedart couriers, HSN 6-digit, GST 5/12/18%, INR values 599–14,999, 1–3 kurta/saree/lehenga items each.
    2. `products.js`: 20 fashion products (Leheriya domain) with variants, images placeholder via picsum.photos seeds, HSN codes, GST%, stock levels, pricing.
    3. `masterSkus.js`: 25 unique Master SKU internal codes (`MSKU-LH-...`), variant attr (Size: S/M/L/XL, Color).
    4. `skuMappings.js`: Master → channel SKU mapping with sync status (Synced / Pending / Error with small error message).
    5. `inventory.js`: Per-warehouse stock + reservation + available balance + stock ledger (40 entries).
    6. `warehouses.js`: 4 entries — WH-001 Physical Mumbai, WH-002 Virtual Shopify, WH-003 Physical Jaipur, WH-004 Return Hub Delhi; includes City + District ONLY (no country per user memory preference).
    7. `vendors.js`: 8 vendors, names like Sandeep Textiles, Rajshree Fabrics, etc., location Jaipur/Ahmedabad/Surat, Telegram group badges.
    8. `shipments.js`: 30 shipment rows, couriers Delhivery/Bluedart/Ecom Express/Xpressbees, AWB, manifest id, dates, tracking status milestones.
    9. `returns.js` + `rto.js` + `ndr.js`: 15 rows each with proper statuses from schema.
    10. `invoices.js`: 25 GST invoices, 6-digit HSN tax breakdown, CGST/SGST/IGST, invoice numbers gapless pattern.
    11. `payments.js` + `reconciliations.js`: 20 Amazon settlement rows with order → payment matching flags (matched / underpaid / missing).
    12. `users.js` + `auditLogs.js` + `notifications.js`: users (Super Admin Momtaj Husen, Admin, Vendors), 30 audit logs, 15 notifications.
    13. `dashboardSeries.js`: 14-day orders time series, revenue by channel array, order status distribution counts, low-stock list, recent orders, activity feed entries.
    14. `reports.js`: 6 reports tab datasets (sales table + chart, inventory summary, etc.)
- Data format rules: NO country strings ("India" explicitly removed from addresses; display city, district only). All money INR formatted via utils helper (money format utility).
- Add `apps/admin/src/utils/format.js`: `formatINR`, `formatDate`, `formatDateTime` (dayjs DD MMM YYYY hh:mm A), `formatPercent`, `statusBadgeVariant(status)` mapping → returns badge variant string.
- **Acceptance Criteria Addressed**: AC-8 (realistic OMS domain data).
- **Test Requirements**:
  - `rule` TR-10.1: Fixture files ≥14 exist under `mocks/`. `ls apps/admin/src/mocks | wc -l ≥ 14`.
  - `rule` TR-10.2: `warehouses.js` locations contain NO occurrence of "India" (case-insensitive grep). Also `orders.js` address lines. Evidence: `grep -i india apps/admin/src/mocks/*.js` returns 0 lines.
  - `rule` TR-10.3: Orders fixture rows ≥20 & products ≥15 & audit logs ≥20. Evidence: node -e eval of `mocks/index.js` export array lengths.
  - `rule` TR-10.4: Marketplaces present = Shopify, Amazon, Myntra only. No "Etsy"/"eBay" strings. Evidence: grep all fixtures for these four names.
  - `rubric` TR-10.5: Domain realism & Leheriya-relevant product names (kurta/saree/lehenga). Scale 1-5; 5=lots of domain variety, 3=some generic, 1=lorem. Threshold ≥4. Evidence: spot-check products.js names.

## Task 11: Final build verification, responsive smoke, README update & Phase completion
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Tasks 1–10 ALL completed
- **Description**:
  - Update `README.md` line "Current Phase: 0/1 — ..." → change to `⚠️ Current Phase: 1 — UI Foundation & Design System` and list what Phase 1 delivered: tailwind, design system, 18+ components, 23+6 module pages, light/dark, charts, vendor shell, routing. Add a new line: `- ⏭️ Next: Phase 2 — Authentication + RBAC + Multi-Tenant`.
  - Commit-msg style note (informational only — commits themselves happen later outside this plan, per 06-GITHUB-WORKFLOW.md): `feat(admin): phase 1 ui foundation & design system, theme + 23 modules + vendor shell + charts + mocks + routing`.
  - Full build: `pnpm --filter @omsking/admin run build` — if errors remain, fix them (e.g. leftover unused imports, broken paths, missing hooks).
  - Run Vite preview server briefly and verify all major routes serve HTML without 404 on refresh.
  - Ensure `pnpm lint` runs without fatal error (lint placeholder already — if real eslint config is cheap, add a minimal one; if not Phase 12, leave lint placeholder passing green as-is).
  - Dev server start-up smoke: `pnpm --filter @omsking/admin run dev` → boots, no errors within 10s, port 5173 HTTP 200 on `/`, `/dashboard`, `/vendor/orders`, `/ui/showcase`.
  - Responsive smoke: adjust viewport widths 1280×800 (desktop), 1024×768 (tablet) — no horizontal overflow, layout does not break. Mobile (375) allowed to show collapsed sidebar toggle.
  - Dark/Light full page toggle check across Dashboard, Orders, Products, Reports, Login, Vendor orders.
- **Acceptance Criteria Addressed**: AC-1 (build), AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9 — final independent re-verify of all nine AC rules before Review phase.
- **Test Requirements**:
  - `rule` TR-11.1: Terminal `pnpm --filter @omsking/admin run build` → exit code 0. Evidence: last 25 lines of output.
  - `rule` TR-11.2: Vite preview (`pnpm --filter @omsking/admin preview`) → curl `/`, `/dashboard`, `/vendor/orders`, `/reports`, `/ui/showcase` all return HTTP 200. Evidence: curl -I outputs.
  - `rule` TR-11.3: No `console.error` or `console.warn` (React warnings) after navigating all 23 routes. Evidence: Browser console message list filtered error level returns 0 entries.
  - `rule` TR-11.4: Toggle theme while on Dashboard → login → vendor orders → no illegible text (no `color: rgb(255,255,255)` on `background: rgb(255,255,255)`). Evidence: Screenshot visual check.
  - `rule` TR-11.5: 1280 & 1024 widths → `document.documentElement.scrollWidth === window.innerWidth` (no horizontal scroll). Evidence: eval at each width.
  - `rubric` TR-11.6: Overall deliverable feels production-ready foundation (consistent, clean, extensible, beautiful). Scale 1-5. Threshold ≥4. Evidence: Full final screenshots (Dashboard, Orders, Settings, Login, Vendor Orders).
