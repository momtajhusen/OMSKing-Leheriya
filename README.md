# OMSKing — Omnichannel Order Management System

> Built for **Leheriya Creations**. SaaS-ready multi-tenant + RBAC architecture from Day 1. Centralizes **Shopify, Amazon, and Myntra** into one platform. 23 modules: Master SKU, Inventory, Orders, Fulfilment, Vendors, Shipping, Returns / RTO / NDR, GST Invoice, Payment & Returns Reconciliation, and more.

---

## ⚠️ Current Phase: 0 — Architecture & Foundation

**Do NOT write business-module code yet.** This phase sets up the complete technical skeleton & blueprint. All architecture decisions are locked and documented under [`docs/`](./docs/).

- ✅ Monorepo (pnpm workspaces + Turborepo)
- ✅ Folder skeleton: `apps/admin`, `apps/backend`, `packages/shared`
- ✅ All planning & architecture documents in [`docs/`](./docs/)
- ✅ Health-check endpoint: `GET /api/v1`
- ⏭️ **Next: Phase 1 — UI Foundation & Design System**

---

## 🧱 Tech Stack (Locked — Do not change)

| Layer | Choice |
|-------|--------|
| Monorepo | **pnpm workspaces** + **Turborepo** |
| Frontend (Admin + Vendor UI, 1 app) | **React 18** + **Vite 5** + **React Router v6** + **Axios** |
| Backend | **Node.js 20** + **Express 4** + **Mongoose 8** |
| Database | **MongoDB** — shared DB, `tenantId` row-level isolation |
| Auth | **JWT** Access Token (15 min) + Refresh Token (7 days, HTTP-only cookie) + **bcryptjs** |
| Validation | **express-validator** |
| API | REST, versioned: `/api/v1/…` |
| Version control | **GitHub** from Day 1 — Conventional Commits, Git-flow-lite |

See full rationale & deferred decisions in [docs/01-TECH-STACK.md](./docs/01-TECH-STACK.md).

---

## 📁 Repository Layout

```
omsking/
├── apps/
│   ├── admin/          React + Vite. BOTH Admin + Vendor roles (guarded routes)
│   └── backend/        Node + Express. REST /api/v1, MongoDB via Mongoose
│
├── packages/
│   └── shared/         Shared constants, roles, formatters. Used by both apps
│
├── docs/               ALL architecture & planning — read before coding
│   ├── 01-TECH-STACK.md
│   ├── 02-DATABASE-SCHEMA.md        23 collections + relations
│   ├── 03-MULTI-TENANCY.md          Shared DB + tenantId rules
│   ├── 04-RBAC-BLUEPRINT.md         Super Admin / Admin / Vendor + permission matrix
│   ├── 05-API-CONVENTIONS.md        Response format, pagination, status codes
│   ├── 06-GITHUB-WORKFLOW.md        Branch strategy + commit format
│   └── 07-FOLDER-STRUCTURE.md       Layer rules, naming conventions
│
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── .gitignore
└── README.md           (this file)
```

---

## 🚀 Setup

### Prerequisites

- **Node.js 18+** (recommended: 20 LTS)
- **pnpm 9+** — install via `npm i -g pnpm`
- **MongoDB 7+** running locally, or MongoDB Atlas URI

### 1. Install dependencies

```bash
cd omsking
pnpm install
```

This installs root devDeps (turbo) + all workspace packages.

### 2. Configure environment

Backend:
```bash
cp apps/backend/.env.example apps/backend/.env
# edit MONGODB_URI, JWT secrets, ports...
```

Admin (optional — Vite API proxy defaults to localhost:5000):
```bash
cp apps/admin/.env.example apps/admin/.env
```

### 3. Run everything (dev mode)

```bash
pnpm dev
```

This starts (via Turborepo, parallel):
- **Backend** on `http://localhost:5000` — health check: `GET http://localhost:5000/api/v1`
- **Admin** on `http://localhost:5173` — Vite + React dev server

### 4. Build for production

```bash
pnpm build
```

### 5. Run lint (placeholder — real config later)

```bash
pnpm lint
```

### 6. Clean build artifacts + node_modules

```bash
pnpm clean
```

---

## 🔒 Architecture Rules — Quick Reference

**Multi-tenancy.** Every collection (except `tenants`) has `tenantId: ObjectId`. It can only come from the JWT — never from request body/params/query. A Mongoose plugin auto-injects the filter on every find/update/aggregate. Leaks prevented; see [docs/03-MULTI-TENANCY.md](./docs/03-MULTI-TENANCY.md).

**RBAC.** Every route needs `auth → tenant → requirePermission(key)` middleware. Vendor role gets an additional scope filter so it only sees its assigned vendor's rows. See [docs/04-RBAC-BLUEPRINT.md](./docs/04-RBAC-BLUEPRINT.md).

**API format.** Every response is `{ success, message, data, meta }`. Lists use pagination (`page`, `limit`, `meta.totalPages`). Status codes follow REST norms. See [docs/05-API-CONVENTIONS.md](./docs/05-API-CONVENTIONS.md).

**Commits.** Conventional Commits: `feat(scope): …`, `fix(scope): …`, `docs: …`, `chore: …`. Branches: `feature/…` → `develop` → (release) → `main`. See [docs/06-GITHUB-WORKFLOW.md](./docs/06-GITHUB-WORKFLOW.md).

---

## 🗺️ 13-Phase Roadmap

| # | Phase | Scope |
|---|-------|-------|
| **0** | **Architecture & Foundation** ✅ | Planning docs + monorepo skeleton. *You are here.* |
| 1 | UI Foundation & Design System | Full clickable UI shell with dummy data. No backend integration. |
| 2 | Authentication + RBAC + Multi-Tenant | Real auth, roles, users, tenant middleware, JWT + refresh flow. |
| 3 | Products + Master SKU + SKU Mapping | First real business module. Catalog + SKU identity layer. |
| 4 | Warehouses + Inventory Engine | *Most critical phase.* Stock, reservations, immutable ledger. |
| 5 | Orders + Fulfilment | Centralized orders from all channels + routing engine. |
| 6 | Vendor Management | Vendor role UI: assigned orders, accept/reject, bulk AWB. |
| 7 | Shipping | AWB generation, label cancel → Shopify revert, manifests. |
| 8 | Returns + RTO + NDR | Reverse leg. Same workflow pattern for all 3. |
| 9 | GST Invoice + Payment & Returns Reconciliation | Gapless invoice numbering, settlement file matching. |
| 10 | Notifications + Settings + Integration Mgmt | Event switch per channel (Telegram/Email/WhatsApp), connections health. |
| 11 | Dashboard + Reports + Audit Logs | Analytics + immutable action history. |
| 12 | Testing, Optimization & Deployment | Production hardening + go-live. |

---

## 📚 Module List (23 total — build target)

1. Authentication · 2. Tenant / Merchant Mgmt · 3. Dashboard · 4. Products · 5. Master SKU · 6. SKU Mapping · 7. Inventory · 8. Warehouses · 9. Orders · 10. Fulfilment · 11. Vendors · 12. Shipping · 13. Returns · 14. RTO · 15. NDR · 16. Notifications · 17. GST Invoice · 18. Settings · 19. Users & Roles · 20. Audit Logs · 21. Integration Management · 22. Payment Reconciliation · 23. Returns/Refunds Reconciliation

Full database collections and their relations in [docs/02-DATABASE-SCHEMA.md](./docs/02-DATABASE-SCHEMA.md).

---

## 🤝 Workflow (repeat every phase)

1. Explain phase scope & confirm what is **out of scope**.
2. Analyze the existing codebase (`docs/` + current state of `apps/`, `packages/`).
3. Produce a detailed implementation plan.
4. Get the plan approved.
5. Implement **only** the approved scope.
6. Test thoroughly.
7. Git commit (conventional format).
8. Move to next phase.

**Read [`docs/`](./docs/) before starting ANY new phase.**
