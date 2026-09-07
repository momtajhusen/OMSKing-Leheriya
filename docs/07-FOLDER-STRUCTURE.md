# Folder Structure & Coding Conventions — OMSKing

## 1. Repo Layout (Top Level)

```
omsking/
├── apps/                          Deployable applications
│   ├── admin/                     React + Vite (Admin + Vendor UI, one app, role-separated)
│   └── backend/                   Node + Express (REST API v1)
│
├── packages/                      Shared, reusable internal packages
│   └── shared/                    Flat shared package: constants, roles, formatters, ids
│
├── docs/                          ALL Phase 0 planning + architecture docs
│   ├── 01-TECH-STACK.md
│   ├── 02-DATABASE-SCHEMA.md
│   ├── 03-MULTI-TENANCY.md
│   ├── 04-RBAC-BLUEPRINT.md
│   ├── 05-API-CONVENTIONS.md
│   ├── 06-GITHUB-WORKFLOW.md
│   └── 07-FOLDER-STRUCTURE.md     (this file)
│
├── .gitignore
├── package.json                   Root workspace manifest (devDeps: turbo)
├── pnpm-workspace.yaml            Workspace globs = "apps/*" + "packages/*"
├── turbo.json                     Turborepo pipelines
└── README.md                      Project overview + setup
```

---

## 2. Backend App Structure (`apps/backend/`)

```
apps/backend/
├── .env.example                   Copy to .env and never commit .env
├── package.json                   (@omsking/backend)
└── src/
    ├── server.js                  ENTRY. calls connectDB() + app.listen()
    ├── app.js                     Express app assembly: middleware + routes
    │
    ├── config/                    index.js = env loader + typed config object
    ├── db/
    │   └── connect.js             mongoose.connect()
    │
    ├── models/                    Mongoose models + schemas. One file per collection.
    │   ├── Tenant.js              (singular, PascalCase — matches collection "tenants")
    │   ├── User.js
    │   ├── Role.js
    │   ├── Product.js
    │   ├── MasterSku.js           → collection "master_skus"  (schema.set collection)
    │   └── ...
    │
    ├── routes/
    │   ├── app.js / index.js      Future: global route mount
    │   └── v1/
    │       ├── index.js           mount('/api/v1', router); health + all modules
    │       ├── auth.routes.js
    │       ├── orders.routes.js
    │       ├── inventory.routes.js
    │       └── ...                one .routes.js file per module
    │
    ├── middleware/                Reusable middlewares
    │   ├── auth.js                JWT decode + attach req.user
    │   ├── tenant.js              Validate tenant, attach req.tenant
    │   ├── requirePermission.js   requirePermission(key) factory
    │   ├── vendorScope.js         Vendor role: apply scope filters
    │   ├── errorHandler.js        notFoundHandler + globalErrorHandler
    │   └── validate.js            express-validator check/schema runner
    │
    ├── controllers/               One file per route-group (mirrors routes/*.routes.js)
    │   ├── auth.controller.js
    │   ├── orders.controller.js
    │   └── ...
    │
    ├── services/                  Complex business flows. Only exists from Phase 3+.
    │   ├── orderFulfilment.service.js    (calls orders + inventory + shipments)
    │   ├── inventoryLedger.service.js    (double-entry booking logic)
    │   └── ...
    │
    ├── utils/                     Pure helpers
    │   ├── response.js            successResponse / errorResponse / paginatedResponse
    │   ├── asyncHandler.js        wrapper → try/catch → next(err)
    │   └── ...
    │
    ├── constants/
    │   ├── roles.js               ROLES enum
    │   ├── orderStatuses.js       order + shipment state machines (Phase 5+)
    │   └── ...
    │
    └── seed/                      ONLY for Phase 2.
        └── defaultSeed.js         Leheriya tenant + super_admin user + default roles
```

**One-sentence rules by layer:**

| Layer | Do | Don't |
|-------|----|-------|
| routes | Declare URLs, wire middleware, delegate to controller | Business logic, DB access, res.json directly |
| controllers | Parse req → call service/model → format response → res.json | Raw MongoDB driver, business-validation logic (use express-validator + services) |
| services | Cross-model business flows, transactions, DTO transformation, book-keeping | Call res.json, parse req.params, render templates |
| models | DB schema, indexes, simple pre/post hooks (e.g. timestamps, lowercase email) | Business logic that touches OTHER models (use services instead) |
| middleware | Stop bad requests early, attach context, log | DB writes that change data (except audit log middleware) |

---

## 3. Admin App Structure (`apps/admin/`)

```
apps/admin/
├── index.html
├── vite.config.js
├── .env.example                   VITE_API_BASE_URL
├── package.json                   (@omsking/admin)
└── src/
    ├── main.jsx                   Entry: BrowserRouter + StrictMode
    ├── App.jsx                    Root router outlet shell
    ├── index.css                  Global reset + design tokens (Phase 1 fills)
    │
    ├── router/
    │   └── index.jsx              Route tree. Guards wrap routes: ProtectedRoute,
    │                              RequireRole, RequirePermission, VendorLayout.
    │
    ├── pages/                     One folder per module, Page.jsx per URL
    │   ├── dashboard/
    │   │   └── DashboardPage.jsx
    │   ├── orders/
    │   │   ├── OrdersListPage.jsx
    │   │   ├── OrderDetailPage.jsx
    │   │   └── OrderNewPage.jsx
    │   ├── vendor/
    │   │   ├── VendorOrdersPage.jsx   (simple, Excel-style)
    │   │   └── VendorShipmentsPage.jsx
    │   └── ...
    │
    ├── components/               Reusable UI pieces (not page-specific)
    │   ├── layout/               AppShell, Sidebar, Header, VendorLayout
    │   ├── ui/                   Design-system atoms: Button, Input, Table, Card, Badge, Modal (Phase 1)
    │   ├── forms/                RHF wrappers (Phase 1)
    │   └── common/               DataTable, EmptyState, StatusPill, PageHeader, Breadcrumbs
    │
    ├── hooks/                    Custom React hooks: usePermission(), useTenant(), useApiList(...)
    ├── context/                  AuthContext, TenantContext, (future) ToastContext
    │
    ├── services/
    │   ├── api.js                Axios instance with interceptors (JWT attach + 401 refresh)
    │   ├── auth.service.js       login(), logout(), refresh()
    │   ├── orders.service.js     listOrders, getOrder, createOrder, updateOrder
    │   └── ...                   One file per resource module
    │
    ├── utils/                    formatCurrency, formatDate, truncate, exportToCsv, cn
    └── constants/                ROLES, API_PATHS, ORDER_STATUSES, SORT_OPTIONS, etc.
```

**Vendor UI lives inside Admin** — not a separate app. A route branch under `/v/*` renders the simpler `VendorLayout` instead of the full `AdminLayout`. Shared components (`DataTable`, `Button`, `Modal`, `StatusPill`) are used by both; vendor pages simply don't import things they shouldn't see (costs, margins, other vendor IDs). Backend security middleware is the actual guard.

---

## 4. Shared Package (`packages/shared/`)

Keep it lean. Split into sub-packages ONLY if/when 3+ real consumers with different needs exist. Current structure:

```
packages/shared/
├── package.json                  (@omsking/shared)
└── src/
    ├── index.js                  barrel exports
    ├── constants/
    │   ├── index.js
    │   └── roles.js              ROLES enum (single source of truth!)
    └── utils/
        └── index.js              formatCurrency, formatDate, generateId, etc.
```

Backend imports it via `require('@omsking/shared')`. Frontend via `import {...} from '@omsking/shared'` (add ESM support in package.json `exports` + `type: module` when frontend actually starts using it in Phase 1).

---

## 5. Naming Conventions

### Files & folders
- Directories: `kebab-case` (e.g. `apps/admin/src/pages/order-returns/`)
- React components + Mongoose models: `PascalCase.js(x)` → `OrderDetailPage.jsx`, `MasterSku.js`
- Everything else (routes, controllers, services, hooks, utils): `kebab-case.js` or `camelCase.js`? — **STICK TO ONE.** We choose:
  - Backend: `camelCase` for JS files, e.g. `auth.controller.js`, `requirePermission.js`, `v1Health.controller.js`
  - Frontend: React pages/components = `PascalCase.jsx`; hooks/services/utils = `camelCase.js`

### Variables & code
- Variables, functions, object keys, JSON payload keys: **camelCase**
- Mongo collections: **snake_case plural** (`order_items`, `inventory_ledgers`) — achieved via `schema.set('collection', 'order_items')` in the Mongoose model. The model filename is still PascalCase singular (`OrderItem.js`).
- React components / hooks: PascalCase + camelCase hook (`useOrdersList`)
- Enums / constants: `UPPER_SNAKE_CASE` (`ROLES.SUPER_ADMIN`, `ORDER_STATUS.PROCESSING`)
- IDs: `_id` in the DB (MongoDB standard); expose `id` via `.toJSON()` transform if desired, but we default to showing `_id` in API responses for simplicity (consistent across stack).
- Environment vars: `UPPER_SNAKE_CASE` (`MONGODB_URI`, `JWT_ACCESS_SECRET`).

---

## 6. General Code Rules (Non-Negotiable)

1. **Sensitive values = `SecureStore` or env vars, never code.** No hardcoded URLs, keys, passwords.
2. **Never console.log in production.** Backend: morgan for access logs, structured logger (future) for app logs. Strip console.log via babel/esbuild plugin on build in Phase 12.
3. **Async errors → wrapped.** `utils/asyncHandler.js` wraps all route handlers so unhandled Promise rejections go to `next(err)` and then global error handler. No unhandled `UnhandledPromiseRejection`s.
4. **Cross-tenant isolation.** If adding a DB query / aggregation / count, verify `tenantId` is the FIRST filter. See checklist in `03-MULTI-TENANCY.md`.
5. **Role permission check on EVERY route.** No route is "open by default except login/refresh/webhook".
6. **Timestamps.** Always use native JavaScript `Date` objects, never Unix numbers unless explicitly required by a 3rd-party API. Store UTC in DB; render in tenant's timezone (Phase 10, setting `timeZone`).
7. **Money = integers in paise? Or floats?** → Phase 9 decision document. For Phase 0: assume Number with 2 decimals, flag for revisiting.
8. **No raw `mongoose.connection.db.collection(...)`.** Always go through a Mongoose model so the multi-tenant plugin runs.
9. **Indexes are part of the schema.** When you add a field that's filtered/sorted, add the index to the schema (`schema.index(...)`) in the same PR. Don't defer "we'll add indexes later".
10. **Security review trigger.** Any PR touching files in the list below gets an extra mandatory review from the owner:
    - `apps/backend/src/middleware/auth.js`
    - `apps/backend/src/middleware/requirePermission.js`
    - Any mongoose multi-tenant plugin file
    - `docs/03-MULTI-TENANCY.md`
    - `docs/04-RBAC-BLUEPRINT.md`
