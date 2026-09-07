# RBAC Blueprint — OMSKing

## Philosophy

Flat, simple, auditable. No ABAC, no policies, no policy engines at launch.

Launch roles (exactly 3, extensible):

| Role code | Friendly name | Who gets it | Scope |
|-----------|---------------|-------------|-------|
| `super_admin` | Super Admin | Leheriya owners + trusted ops managers | EVERYTHING — no restrictions. Creates/edits users, manages tenants, does finance. |
| `admin` | Admin / Ops | Day-to-day operations staff | All business modules except: user mgmt, tenant settings, finance (reconciliation), audit logs view |
| `vendor` | Vendor | External vendors / dropshippers | **Only their assigned vendors' rows.** Sees orders assigned to them, can accept/reject, update dispatch, upload AWB in bulk (Excel-style, Phase 11). Cannot see other vendors, cannot see prices/costs, cannot see finance. |

Additional roles (Operations Manager, Customer Support, Finance, Warehouse Picker, etc.) will be added by Phase 2+ as rows in the `roles` collection — no code changes, just permission bit changes.

---

## Permission Model — Flat Permission Keys

Format: `<module>.<action>`  
Modules: `auth`, `tenants`, `users`, `roles`, `dashboard`, `products`, `master_skus`, `sku_mappings`, `warehouses`, `inventory`, `orders`, `fulfilment`, `vendors`, `shipping`, `returns`, `rto`, `ndr`, `invoices`, `payments`, `reconciliations`, `notifications`, `audit_logs`, `integrations`, `settings`.

Actions: `read`, `create`, `update`, `delete`, `export`, `approve`, `manage` (manage = all + destructive).

Example permission keys:
```
orders.read
orders.create
orders.update
orders.delete
orders.export
orders.approve          (e.g. approve cancellation / approve return)
orders.manage
inventory.update
invoices.create
reconciliations.read
audit_logs.read
users.manage
```

`manage` = meta-permission that implies `read,create,update,delete,export,approve` for that module.

### Launch Permission Matrix

| Module | super_admin | admin | vendor |
|--------|:-----------:|:-----:|:------:|
| auth (self) | ✓ | ✓ | ✓ |
| tenants | manage | — | — |
| users | manage | read | — |
| roles | manage | — | — |
| dashboard | read | read | limited (own stats) |
| products | manage | manage | — |
| master_skus | manage | manage | — |
| sku_mappings | manage | manage | — |
| warehouses | manage | read | — |
| inventory | manage | read + update (PO/adjust limited) | — |
| orders | manage | read + update | read + update (only assigned) |
| fulfilment | manage | manage | read + update (only assigned) |
| vendors | manage | read | read (only own row) |
| shipping | manage | manage | limited (AWB upload only) |
| returns | manage | read + approve | — |
| rto | manage | read + update | — |
| ndr | manage | read + update | — |
| invoices | manage | read + create | — |
| payments | manage | read | — |
| reconciliations | manage | read | — |
| notifications | manage | read | read (own) |
| audit_logs | read | limited | — |
| integrations | manage | read | — |
| settings | manage | read-only (non-secret) | — |

"limited" = defined at query time by extra filters (see Vendor Scope middleware).

---

## Backend Middleware Stack (per protected route)

```
Route:  /api/v1/orders

Middleware chain (left → right):
1. authMiddleware           → decode JWT access token, attach req.user
                              (if invalid/expired → 401)

2. tenantMiddleware         → verify req.user.tenantId exists in DB,
                              tenant.status = active. attach req.tenant
                              (if bad tenant → 403)

3. requirePermission(       → compare req.user.role.permissions array
     "orders.read"          against the required key(s). If any match
   )                        → allow. Else 403 + detail "Missing permission:
                              orders.read".

4. vendorScopeMiddleware    → ONLY if role === 'vendor'. Auto-injects
                              additional filters (e.g.
                              where({ assignedVendorId: {$in: user.assignedVendorIds} })).
                              If a vendor tries to read an order that is
                              NOT assigned to one of their vendorIds → 404,
                              NOT 403 (prevents ID enumeration).

5. Controller / Handler     → actual logic. req.user + req.tenant GUARANTEED
                              at this point.
```

### Example route registration

```
// apps/backend/src/routes/v1/orders.routes.js
router.get(
  '/',
  auth,
  tenant,
  requirePermission('orders.read'),
  vendorScope('orders'),
  listOrders,
);

router.patch(
  '/:id/status',
  auth,
  tenant,
  requirePermission('orders.update'),
  vendorScope('orders', { allowWrite: true }),
  updateOrderStatus,
);
```

---

## Frontend Route Guards (React Router v6)

```
<Route element={<ProtectedRoute allowedRoles={[SUPER_ADMIN, ADMIN, VENDOR]} />}>
  <Route element={<AppShell />}>

    <Route element={<RequirePermission permission="dashboard.read" />}>
      <Route path="/dashboard" element={<Dashboard />} />
    </Route>

    <Route element={<RequireAnyPermission perms={["products.read","products.manage"]} />}>
      <Route path="/products" element={<ProductsPage />} />
    </Route>

    <Route element={<RequireRole roles={[SUPER_ADMIN, ADMIN]} />}>
      <Route path="/users" element={<UsersPage />} />
      <Route path="/finance/reconciliation" element={<ReconPage />} />
    </Route>

    {/* Vendor-specific layout variant — wraps children in Excel-style shell */}
    <Route element={<VendorLayout />}>
      <Route element={<RequireRole roles={[VENDOR]} />}>
        <Route path="/v/orders" element={<VendorOrders />} />
        <Route path="/v/shipments" element={<VendorShipments />} />
      </Route>
    </Route>

  </Route>
</Route>
```

Additionally: every menu item, every action button, every sensitive number (cost prices, margins, payouts) must be wrapped in the same permission hooks at render time. Frontend guards are UX convenience, NOT security. **Backend middleware is the real security boundary.**

---

## Session & Logout Model

- **Access token:** JWT, 15 minutes, stored in-memory (React state) on Admin client.
- **Refresh token:** JWT, 7 days, stored in HTTP-only Secure cookie with `sameSite: lax`.
- **Logout (button):** Call `POST /api/v1/auth/logout` → backend increments `refreshTokenVersion` on the user row → clears the HTTP cookie → frontend clears memory access token → redirects to login.
- **Sessions page (super_admin):** Shows all active refresh token versions. "Log out user" = bump version.
- **Password change / reset:** Bump `refreshTokenVersion` too (all old sessions killed).

---

## Adding a New Role (Future, no code change)

1. Super Admin → Settings → Roles → Create role → name, code
2. Tick permission checkboxes per module (uses the flat matrix)
3. Assign to users
4. Backend middleware `requirePermission(key)` already works because it checks the permissions array stored on the role row.

The ONLY code changes needed for future roles are:
- If a brand-new module is introduced → add its keys to the seed list
- If a brand-new scope restriction is introduced (e.g. "warehouse picker can only see their own WH") → extend `vendorScopeMiddleware` into a generic `scopeMiddleware` that understands scope configs per role row.
