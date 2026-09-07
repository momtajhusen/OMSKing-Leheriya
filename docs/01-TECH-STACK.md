# Tech Stack Decision — OMSKing

Locked on Day 1. Do not change any of these without explicit approval and a Phase 0 amendment.

## 1. Monorepo & Build Tooling

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Package manager | **pnpm** (v9+) | Strict hoisting, disk-efficient, workspaces first-class, faster installs than npm/yarn for monorepos. |
| Workspace glue | **pnpm workspaces** | Native, zero-config, no extra runtime. `pnpm-workspace.yaml` defines `apps/*` and `packages/*`. |
| Task orchestrator | **Turborepo** v2 | Incremental caching, parallel execution, remote-cache ready (future Vercel/GH Actions). `turbo.json` pipelines for `build`, `dev`, `lint`, `clean`. |

## 2. Frontend (Admin Panel — covers both Admin + Vendor roles)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Library | **React 18** | Mature, huge ecosystem, known by the team. Future: Next.js migration optional. |
| Bundler / Dev Server | **Vite 5** | Near-instant HMR, native ESM, Rollup production builds, ~10× faster dev startup than CRA. |
| Routing | **React Router v6** | De-facto standard. Nested routes simplify role-based sub-layouts (Admin vs Vendor shell). |
| HTTP client | **Axios** | Interceptors (JWT attach + 401 refresh), request cancel, base URL config — cleaner than raw fetch. |
| UI / Design System | *Deferred to Phase 1* | Will choose MUI / Ant / Tailwind + shadcn/ui based on Phase 1 shell requirements. |

**Why NO separate Vendor React app:** Vendor UI is a deliberately simpler Excel-style subset of the Admin experience. Sharing the same build (same router, same auth context, same API client, same design tokens) eliminates build duplication, cuts deploy targets in half, and makes role-switch testing trivial. Restriction is done entirely via route guards + conditional UI rendering.

## 3. Backend

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | **Node.js 20 LTS** | LTS stability, widest package ecosystem, single-language full stack. |
| Framework | **Express 4** | Minimal, un-opinionated, most widely understood Node framework. NestJS was evaluated and rejected for Phase 0 — too much boilerplate for a 1-person team; can be refactored later if complexity demands. |
| ODM | **Mongoose 8** | Schema validation (critical for multi-tenant data integrity), middleware hooks, population, aggregation helpers on top of native MongoDB driver. |
| Validation | **express-validator** | Lightweight, decorator-free, covers 95% of route-level needs. Zod will be evaluated in Phase 2 for complex nested schemas. |
| Logging (dev) | **morgan** + `console` | Simple request logs. Structured JSON logging (pino/winston) deferred until Phase 12 (deployment). |
| Dev runner | **nodemon** | File-watch restart for the Express process. |

## 4. Database

| Choice | Rationale |
|--------|-----------|
| **MongoDB** (Mongoose ODM) | Document model fits e-commerce naturally (orders have nested items, SKUs have per-channel maps, returns have dynamic QC fields). Flexible schema is ideal for 23 fast-evolving modules without costly ALTER TABLE migrations. ACID via transactions (v4.0+) covers inventory-ledger + order double-writes. **PostgreSQL explicitly rejected** in Phase 0 scope. |

Hosting: Self-hosted MongoDB 7 or MongoDB Atlas depending on Phase 12 deployment decision. Connection via single `MONGODB_URI` env var.

## 5. Authentication & AuthZ

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Auth mechanism | **JWT Access Token + Refresh Token** | Stateless backend, refresh token stored in HTTP-only cookie (security), access token short-lived (15 min) in memory/secure storage. Passport/OAuth2 deferred — first-party users only at launch. |
| Password hashing | **bcryptjs** (cost 12) | No native binding issues, standard NIST recommendation. |
| AuthZ | **RBAC — Role-based** (hand-rolled middleware, no CASL yet) | Only 2 launch roles: Super Admin + Vendor. A permission matrix + a single `requireRole(...)` middleware keeps the stack lean. CASL/ABAC can be added for Phase 2+ granular permissions if needed. |
| Tenancy enforcement | **Mongoose plugin + Express middleware** | Tenant ID extracted from JWT payload, auto-injected into every query & write via a global plugin. See `03-MULTI-TENANCY.md`. |

## 6. API Style

| Choice | Rationale |
|--------|-----------|
| **REST** (not GraphQL) | Simpler debugging via Postman/curl, better caching story for read-heavy inventory/order lists, smaller cognitive load for the integration layer (Shopify/Amazon/Myntra webhooks map 1:1). GraphQL will be re-evaluated only if a use-case (e.g. complex dashboard joins) justifies it. |
| Version prefix | **`/api/v1/…`** on every route. | Break-the-glass v2 can be introduced later without disturbing v1 clients or mobile integrations. |

## 7. Version Control & CI/CD

| Choice | Rationale |
|--------|-----------|
| **GitHub** (from Day 1) | Free private repos, Actions for CI, branch protection, PR reviews. First push: Phase 0 commit. |
| Branch strategy | Git-flow-lite: `main` ← `develop` ← `feature/*`, `hotfix/*`. See `06-GITHUB-WORKFLOW.md`. |
| Commit format | **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`). |

---

### Why no extra choices (intentionally deferred)

| Concern | Status |
|---------|--------|
| CSS / component library | Phase 1 (UI Foundation) |
| State management (Redux/Zustand/Context) | Phase 1, after we see real app complexity |
| Form library (RHF / Formik) | Phase 1 |
| Notification delivery (Telegram/Email/WhatsApp) | Phase 10 |
| Queue / background jobs (BullMQ) | Phase 5+ when async order sync is needed |
| Object storage (S3-compatible) | Phase 3 (Products — images, invoice PDFs) |
| Deployment target / CD | Phase 12 |
