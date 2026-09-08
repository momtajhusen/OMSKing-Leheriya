# OMSKing — Phase 1: UI Foundation & Design System
## spec.md (v2 — updated against Agreement, Roadmap, and confirmed handwritten business-rule notes)

> **Change note (v2):** This revises the original Phase 1 PRD after cross-checking it against:
> `Leheriya_OMS_Final_Combined_Agreement.pdf`, `OMSKing_Development_Phase_Roadmap.pdf`, and the
> handwritten annotation photos on the working proposal (tenant onboarding, product mapping flow,
> order fulfilment routing, reconciliation, courier ownership, restock destination, notification
> toggles, GST invoice template, Shipway/OMS Guru reference screenshots). Every section below marked
> **🆕 Updated** contains a change driven by that material. Everything else is unchanged from v1.
> Reminder: **Phase 1 has zero backend logic** — all items below are *dummy-data visual
> representations only*, so the real workflow can be validated visually before Phase 2–12 build it.

---

## 1. Overview
Phase 1 delivers a fully clickable, professionally designed **Admin + Vendor Panel UI shell** on a
shared design system. 23 module pages are built with realistic dummy data, light/dark theming,
shared reusable components, a three-pane layout shell, and role-based routing. No backend API
integration occurs — every screen is populated from mock fixtures in `mocks/`.

**Purpose**: Lock UX, information architecture, and interaction patterns — including the specific
business rules Leheriya confirmed by hand on the proposal — before real logic is built in Phase 2+.
Mis-shaped UI is cheap to fix now and expensive to fix after Phase 4–9 wire real data into it.

**Target Users**: Super Admin, Admin, Vendor (Vendor shell deliberately simpler, Excel-style), and
the dev team building Phases 2–12 on top of this shell.

---

## 2. Goals
1. Typed, scalable **design system** (tokens + CSS vars + Tailwind config + primitives).
2. **Light + Dark mode** toggle via context provider, both fully themed in OMSKing navy/amber brand.
3. **Admin shell** — collapsible sidebar (23 modules), sticky header (theme, notifications,
   breadcrumbs, avatar menu), independently scrolling multi-pane content (Blinkit/Instamart-style).
4. **Vendor shell** — Excel-style, compact sidebar, fewer modules, dense tabular layout.
5. **Skeleton pages with realistic dummy data** for all 23 modules — see §6 for per-module detail,
   now reflecting confirmed workflow rules (not generic placeholders).
6. Mock charts on Dashboard; role-aware routing (React Router v6); 404 page.
7. Production build succeeds (`pnpm --filter @omsking/admin run build`); `vite preview` loads clean.
8. Staggered cascade animations, `cubic-bezier(0.22, 1, 0.36, 1)` easing on all transitions.

---

## 3. Non-Goals (unchanged)
1. No backend integration — no real API calls, auth, or DB. Fixtures only.
2. No Phase 2–12 business logic (auth, RBAC middleware, SKU engine, inventory ledger, real
   reconciliation matching, real Telegram/WhatsApp sends).
3. No server-side search/filter/pagination.
4. No production hardening (Phase 12).
5. No Storybook.
6. No responsive support below 1024px (desktop-first; mobile is a separate project).
7. No SSR/Next.js — React 18 + Vite SPA only.

> **🆕 Clarification**: Courier-rate comparison (seen in the Shipway reference video — Amazon
> Shipping Surface / Ekart / Bluedart Air / Delhivery Air with price + ETA cards) is **UI-only** in
> Phase 1: static mock cards, no live rate API. Real integration is Phase 7.

---

## 4. Background & Context (unchanged, +1 addition)
1. Phase 0 lock: React 18 + Vite + React Router 6, Node+Express backend, MongoDB→**PostgreSQL**
   (⚠️ see §11 open item — roadmap doc specifies PostgreSQL, original PRD said MongoDB; align before
   Phase 2 schema work, does not block Phase 1 since no DB is touched).
2. Roadmap Phase 1: "Dummy-data skeleton for every module — no backend connected yet."
3. 23 modules per agreement §4 (final list — GST Invoice is its own module, not folded into Settings).
4. UI/UX preference: Blinkit/Instamart layouts, staggered animation, badges aligned to price rows,
   City+District location display (no country — confirmed again in AC-8 domain rubric).
5. RBAC roles: **Super Admin** (full control) and **Vendor** (restricted) at launch — agreement §7
   confirms only these two roles exist at launch, "Admin" as a third distinct role is not in the
   signed scope. **🆕** Phase 1 sidebar role-filtering should therefore visually demo exactly these
   two roles, not three (see §11 open item — resolve before FR-2 sidebar grouping is finalized).

---

## 5. Confirmed Business Rules Phase 1 Must Visually Represent 🆕
These are rules Leheriya confirmed (agreement §5/§10 + handwritten annotations) that don't require
backend logic yet, but **do** require a specific dummy field, button, tab, or table column to exist
in Phase 1 so the visual walkthrough actually validates the real workflow later:

| # | Rule | Where it must appear in Phase 1 UI |
|---|------|-------------------------------------|
| 1 | Order ID format matches real Shopify pattern (`65207-LEH`), not generic `ORD-0001` | Orders, Dashboard, Shipping, Returns fixtures |
| 2 | Multi-qty line item → posted to vendor twice as `65234-1` / `65234-2` | Vendors module dummy order rows |
| 3 | New tenant onboarding → import products channel-wise: Shopify → Myntra → Amazon, auto-map same SKU | Tenant/Merchant Mgmt page — 3-step import wizard mock |
| 4 | New product mapping decision flow (exists on another channel? → auto-map / else → Unmapped Listings → manual create or map by Master SKU) | Master SKU / SKU Mapping page — flow shown as a static diagram or 2-state table (Mapped / Unmapped) |
| 5 | Order fulfilment routing: Offline-warehouse line items → pack & ship directly; Virtual-warehouse-only line items → routed to vendor | Fulfilment page — two-column mock ("Direct Ship" vs "Vendor Routed") |
| 6 | "Assign Vendor" field auto-fetches vendor name from Shopify, shown as an editable dropdown | Orders detail / Fulfilment page |
| 7 | "Assign Price" field auto-fetches cost from Shopify | Orders detail / Fulfilment page |
| 8 | Pickup Warehouse selector: WH1 / WH2 checkboxes + "Add Address" option | Warehouses page |
| 9 | Manual "Sync Orders" button (for when an order isn't auto-fetched) | Orders page toolbar |
| 10 | Vendor order-assignment auto-sends a notification message to Leheriya's own number | Notifications page — shown as a fixed/non-togglable "Owner Alert" row, distinct from the configurable list |
| 11 | GST Invoice Order ID = same as Shopify Order/Invoice number | GST Invoice page — invoice preview mock |
| 12 | GST Invoice: editable HSN & GST%, Master HSN upload (GST% auto-filled from HSN), download/print PDF, send via WhatsApp or email | GST Invoice page |
| 13 | Reconciliation — Shopify tab: excludes Paid/Cancelled; flags Fulfilled+Unpaid+Old orders | Reports → Reconciliation tab / Payment Reconciliation module |
| 14 | Reconciliation — Amazon/Myntra tab: "Upload Payment File" → Payment Received; "Upload Return File" → Return Received | Payment Reconciliation module |
| 15 | Reconciliation table columns: Order ID, Status (Pending/Delivered/Returned), Payment Status, Return Status, Ref No. | Returns/Refunds Reconciliation module |
| 16 | Courier ownership: Amazon/Myntra generate labels via their own courier; Shopify orders use Leheriya's own courier accounts (Delhivery/Bluedart/Ecom Express/Xpressbees) | Shipping page — courier column shows "Marketplace Courier" badge vs. a selectable own-courier dropdown |
| 17 | Shipping courier-rate comparison cards (price + ETA per courier, "Recommended" badge) — modelled on the Shipway reference screen | Shipping page — order detail / label-generation mock |
| 18 | Payment modes synced: COD, Prepaid, Partially Paid (treated as COD), Void | Orders — payment-mode badge/filter |
| 19 | Restock destination on Return/RTO: All / Shopify(Offline) / Amazon / Myntra / None | Returns & RTO page — radio/checkbox group |
| 20 | Dashboard status tabs: New, Processing, Pending, Dispatched, Delivered | Dashboard page tabs (in addition to the 6 KPI cards) |
| 21 | Notifications must be **individually togglable** per event type, not all-or-nothing (confirmed twice — agreement §5 and handwritten note) | Notifications page — every row has its own on/off switch |
| 22 | Notification events × channels matrix: New Order / Vendor Order / Dispatch Update / Shipping Update / Delivery Update / Return / Inventory Alerts / System Alerts — across Telegram / Email / WhatsApp / Other | Notifications page layout |
| 23 | Vendor panel table columns: Order ID, Photo, Cost, Dispatch Date | Vendor → Orders (Excel-style table) |
| 24 | Same phone number allowed across multiple vendors (no uniqueness constraint) | No visual element needed — noted for Phase 6 backend, informational only |
| 25 | Invoice generation allowed for **all** orders, not just some statuses | GST Invoice page — no status-based disabling on the "Generate Invoice" button |

---

## 6. Functional Requirements

- **FR-1**: Admin shell — fixed 3-column layout, collapsible sidebar (256px ↔ 64px), sticky header
  (64px), independently scrollable content pane, sidebar toggle in header.
- **FR-2 🆕**: Admin sidebar exposes all **23 modules**, grouped as: Core Operations, Catalog,
  Inventory & Storage, Orders & Fulfillment, Reverse Logistics, Finance, Platform. Role filter
  demoed for **Super Admin (all 23)** and **Vendor (5 modules)** — do not visually imply a third
  "Admin" role tier unless the open question in §11 resolves that it exists.
- **FR-3**: Global ThemeProvider — light/dark persisted to `localStorage`, toggled via header icon,
  full Tailwind `dark:` class-based theming.
- **FR-4**: Shared component library, 18+ primitives (Button, Input, Textarea, Select, Card, Badge,
  Tag, Avatar, Table w/ sticky header + zebra rows, Tabs, Modal, Drawer, DropdownMenu, Toast, Loader,
  EmptyState, Alert, Breadcrumbs, Sidebar, Header), theme-safe, `className` mergeable.
- **FR-5**: Every module page: title, description, ≥2 stat cards, one `<Table>` (5–15 rows), ≥1
  primary button — **plus** whatever module-specific elements are listed in §5's table for that
  module (this supersedes the generic "any 2 cards + 1 table" minimum for the 13 modules named
  in §5).
- **FR-6 🆕**: Dashboard ships:
  - 6 KPI cards (Revenue, Orders, Fulfillment Rate, Returns %, RTO %, Avg Shipment Days)
  - **Status tabs**: New / Processing / Pending / Dispatched / Delivered (agreement §10, rule #20
    above) — sits above or beside the KPI row
  - 2 line/bar charts (order volume last 14 days; revenue by channel Shopify/Amazon/Myntra)
  - 1 doughnut (order status split)
  - Low-stock table, recent-orders table, recent-activity feed (staggered fade-in)
- **FR-7**: Route-change transitions — 120ms fade-out, 160ms staggered fade+slide-in (translateY
  8px→0), `cubic-bezier(0.22, 1, 0.36, 1)`.
- **FR-8 🆕**: Vendor shell (`/vendor/*`) — compact sidebar with exactly 5 items (Orders, Products,
  Shipping, Returns, Settings), Excel-style dense table (font ≤13px, row height ≤32px, thin
  borders). Vendor **Orders** table columns are specifically: **Order ID, Photo, Cost, Dispatch
  Date** (rule #23) — do not substitute a generic column set here.
- **FR-9**: React Router v6 — `/` → `/dashboard`; `/auth/*` (non-POSTing login/forgot-password);
  `/dashboard` + 23 module routes; `/vendor/*`; catch-all `*` → 404.
- **FR-10 🆕**: Mock fixtures in `apps/admin/src/mocks/` use:
  - **Real Shopify order-ID pattern**: `65207-LEH`, `65208-LEH`, etc. (not `ORD-0001`)
  - Multi-qty vendor-split example: at least one fixture row demonstrating `65234-1` / `65234-2`
  - INR ₹, Mumbai/Delhi/Jaipur/Bengaluru (City + District, no country)
  - Couriers: Delhivery, Bluedart, Ecom Express, Xpressbees
  - Marketplaces: Shopify, Amazon, Myntra only
  - HSN 6-digit codes, GST 5%/12%/18%
  - Order statuses: Pending / Processing / Awaiting_Shipment / Shipped / Delivered /
    Return_Requested / RTO_In_Transit / NDR
  - Payment modes: COD, Prepaid, Partially Paid, Void (rule #18)
- **FR-11**: Global toast system (react-hot-toast); sample trigger buttons on Settings page.
- **FR-12**: Settings page — 5 tabs: Company, Channels, Couriers, Tax & GST, API Credentials.
- **FR-13**: Reports page — 6 tabs: Sales, Inventory, Shipping, Returns, **Reconciliation** (must
  include the Shopify-tab / Amazon-Myntra-tab distinction from rules #13–14), Vendors.
- **FR-14 🆕**: GST Invoice page — dummy invoice preview matching the real template style captured
  in the reference screenshot: Supplier / Bill To / Ship To three-column header, item table with
  Qty/Unit Price/HSN/Taxable Value/GST/IGST/Discount/Total, totals block, "Total in words," QR code
  placeholder. Buttons: Edit HSN & GST, Upload Master HSN, Download PDF, Print, Send via WhatsApp,
  Email to Customer (rule #12). Invoice number field pre-filled to equal the mock Order ID (rule #11).
- **FR-15 🆕**: Notifications page — table/grid of event rows (New Order, Vendor Order, Dispatch
  Update, Shipping Update, Delivery Update, Return, Inventory Alerts, System Alerts) × channel
  toggles (Telegram, Email, WhatsApp "where API supported," Other Suitable Services). Each row has
  its **own independent on/off switch** (rule #21/#22). Include one non-togglable "Owner Alert on
  Vendor Assignment" row, visually distinguished (e.g. locked icon) per rule #10.
- **FR-16 🆕**: Shipping page — order/label mock includes a courier-rate comparison card set (styled
  after the Shipway reference video: courier logo, price, ETA, a "Recommended" badge on one card,
  a "Ship with X" button) for Shopify orders, and a static "Marketplace Courier — Amazon/Myntra"
  badge (no selection needed) for Amazon/Myntra orders, reflecting rule #16–17.
- **FR-17 🆕**: Returns & RTO page — restock-destination control (radio/checkbox: All, Shopify
  Offline, Amazon, Myntra, None) attached to each returned/RTO'd item row (rule #19).
- **FR-18 🆕**: Tenant/Merchant Mgmt page — "New Tenant" flow mock: a 3-step wizard/stepper
  (Shopify → Myntra → Amazon) with "Import All Products" action and a note that same-SKU items
  auto-map (rule #3).
- **FR-19 🆕**: Master SKU / SKU Mapping page — Mapped / Unmapped Listings tabs; an "Unmapped"
  row shows two actions: "Create as New Product" and "Map to Existing (enter Master SKU)" (rule #4).
- **FR-20 🆕**: Fulfilment page — two-lane mock: "Direct Ship (Offline Stock)" vs. "Routed to
  Vendor (Virtual Stock)" (rule #5), each lane showing sample order/line-item cards.
- **FR-21 🆕**: Warehouses page — Pickup Warehouse selector with WH1/WH2 checkboxes and an "Add
  Address" button (rule #8).
- **FR-22 🆕**: Orders page toolbar includes a "Sync Orders" button in addition to existing filters
  (rule #9).

---

## 7. Non-Functional Requirements (unchanged from v1)
- **NFR-1**: Build exits 0; JS bundle ≤ 800KB gzipped.
- **NFR-2**: No uncaught console exceptions; Rules of Hooks followed.
- **NFR-3**: Accessibility — labeled inputs/buttons, aria-labels on icon buttons, header→sidebar→
  content tab order.
- **NFR-4**: `dayjs` + `DD MMM YYYY, hh:mm A`; `Intl.NumberFormat('en-IN', {style:'currency',
  currency:'INR'})`; percentages to 1 decimal.
- **NFR-5**: Vite dev server starts <4s; HMR functional.
- **NFR-6**: Folder structure per Phase 0 `07-FOLDER-STRUCTURE.md`.
- **NFR-7**: Semantic Tailwind tokens only — no raw hex in JSX.
- **NFR-8**: No blocking animation >400ms; `prefers-reduced-motion` disables non-essential motion.

---

## 8. Constraints (unchanged from v1)
- React 18 + Vite 5 + React Router v6 — no Next.js/Remix.
- `zustand` for theme/UI shell state — no Redux.
- Tailwind CSS 3 only — no styled-components/SCSS/Emotion; remove legacy inline styles.
- `lucide-react` icons exclusively.
- `recharts` for all charts.
- React Hook Form + Zod pattern demoed on ≥1 form (Login, Settings→Company).
- Brand: Navy Blue primary, warm Amber secondary — no pink/purple.
- Vendor UI: dense, small fonts, thin borders — not card-heavy.
- New deps → `apps/admin/package.json`; `@omsking/shared` stays CommonJS, unused in Phase 1.
- shadcn-ui-style `--color-*` CSS var naming convention.

---

## 9. Assumptions (unchanged from v1, +1)
1. Phase 2 implements real auth; Phase 1 login only validates client-side + "Continue as Demo
   Super Admin" button sets a localStorage flag for route-guard testing.
2. `pnpm install` run once from root; assumes internet access.
3. Manual visual inspection at `localhost:5173`; no automated visual regression yet.
4. Agreement + Roadmap PDFs define identical scope to the README/Phase-0 module list — **now cross-
   checked against handwritten notes as well; no contradictions found beyond the two items in §11.**
5. Hero/shared-element transitions used for list→detail nav where feasible.

---

## 10. Open Questions — Needs Client/Team Confirmation Before Later Phases 🆕

1. **Database engine mismatch**: Original PRD background states MongoDB; the official Roadmap
   document (Phase 0 tasks) specifies PostgreSQL. Doesn't block Phase 1 (no DB touched), but must
   be resolved before Phase 0/2 schema work begins.
2. **Role count**: Agreement §7 confirms only **Super Admin** and **Vendor** at launch. The original
   Phase 1 PRD's "Target Users" line lists Super Admin, Admin, *and* Vendor as three separate roles.
   Confirm whether "Admin" is meant as a synonym for Super Admin in casual usage, or a real third
   role — this changes FR-2's sidebar-filtering demo.
3. **Vendor phone-number reuse** (rule #24) and **invoice generation for all order statuses** (rule
   #25) are informational/backend rules with no Phase 1 visual element — flagged here so they aren't
   dropped by the time Phase 6/9 build the real logic.

---

## 11. Acceptance Criteria

Acceptance criteria AC-1 through AC-9 from the original Phase 1 PRD remain in force unchanged
(build success, theme engine, 23-module sidebar, vendor shell, dashboard KPIs, transitions,
component library, fixture realism, code hygiene). Two are extended:

### AC-3 (extended): Admin Shell Layout & 23-Module Sidebar
All original conditions apply, **plus**: each of the 13 modules named in §5 must show its specific
mock elements (e.g. GST Invoice shows the invoice preview and edit/download/WhatsApp/email buttons;
Notifications shows the per-event toggle grid; Warehouses shows the WH1/WH2 pickup selector) —
not just a generic card+table.

### AC-5 (extended): Dashboard
All original KPI/chart/table conditions apply, **plus** the five status tabs (New / Processing /
Pending / Dispatched / Delivered) must be present and switchable, each filtering the mock
recent-orders table by that status.

### AC-10 (new): Confirmed Business-Rule Coverage
- **Type**: `rubric`
- **Dimension**: How completely the 25 confirmed rules in §5 are visually represented
- **Scale**: 1–5
- **Anchors**:
  - 1 = Fewer than 5 of the 25 rules have any visible UI element
  - 3 = 12–18 of 25 rules represented; some modules still generic
  - 5 = All 25 applicable rules (23 visual + 2 informational, explicitly noted as non-visual) are
    traceable to a specific page/element; a reviewer can check off every row in §5's table against
    a running Phase 1 build
- **Pass Threshold**: ≥ 4
- **Evidence**: Screenshot per row of §5's table, or a single annotated walkthrough video mapping
  each rule to its on-screen element.