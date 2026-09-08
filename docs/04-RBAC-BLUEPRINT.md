# RBAC Blueprint — OMSKing

Design matches product spec §12 (Permissions / RBAC). Frontend guards are UX only. **Server-side `tenantId` + `requirePermission(key)` is the security boundary.**

---

## 12.1 Platform Roles

| Role code | Name | Scope |
|-----------|------|--------|
| `platform_admin` | Platform Admin | Full **SaaS** access: subscribers, plans, Open tenant. No merchant packing desk of its own. |
| `super_admin` | Merchant Super Admin | Full access **inside own tenant only**. Users, settings, finance, catalog, ops. |
| `operations` | Operations | Orders, fulfilment, shipping, vendors. |
| `warehouse` | Warehouse | Inventory, picking, packing, dispatch. |
| `accounts` | Accounts | Payments, reconciliation, finance. |
| `catalog_manager` | Catalog Manager | Products, SKUs, mappings. |
| `customer_support` | Customer Support | Orders, customers, returns, shipment info on the order (not label generate). |
| `vendor` | Vendor | Assigned vendor orders and required dispatch only. |

`admin` is a **legacy alias** of `operations` (old demo logins / tokens). New users get `operations`.

Platform Admin is **not** a tenant role and is never assigned on Users & Roles inside a merchant.

---

## 12.2 Permission Model

Do **not** authorize with `if (role === 'operations')`. Store a `permissions: string[]` on the role (and copy onto the JWT). Check keys:

```
orders.view
orders.edit
orders.cancel
inventory.view
inventory.adjust
shipping.generate
shipping.cancel
returns.approve
finance.view
finance.reconcile
users.manage
settings.manage
```

Catalog / support extras (same pattern):

```
catalog.view
catalog.edit
customers.view
```

SaaS-only:

```
tenants.manage
```

Default grants (seed). Super Admin has every **tenant** key. Platform Admin has `tenants.manage`, `users.manage`, `settings.manage` on the platform account only.

| Key | Super Admin | Operations | Warehouse | Accounts | Catalog | Support | Vendor |
|-----|:-----------:|:----------:|:---------:|:--------:|:-------:|:-------:|:------:|
| orders.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ assigned |
| orders.edit | ✓ | ✓ | ✓ | — | — | — | ✓ assigned |
| orders.cancel | ✓ | ✓ | — | — | — | — | — |
| inventory.view | ✓ | ✓ | ✓ | — | ✓ | — | — |
| inventory.adjust | ✓ | — | ✓ | — | — | — | — |
| shipping.generate | ✓ | ✓ | ✓ | — | — | — | ✓ assigned |
| shipping.cancel | ✓ | ✓ | — | — | — | — | — |
| returns.approve | ✓ | ✓ | — | — | — | ✓ | — |
| finance.view | ✓ | — | — | ✓ | — | — | — |
| finance.reconcile | ✓ | — | — | ✓ | — | — | — |
| users.manage | ✓ | — | — | — | — | — | — |
| settings.manage | ✓ | — | — | — | — | — | — |
| catalog.view | ✓ | ✓ | — | — | ✓ | — | — |
| catalog.edit | ✓ | — | — | — | ✓ | — | — |
| customers.view | ✓ | ✓ | — | ✓ | — | ✓ | — |

A Super Admin may tighten a custom role by editing the `permissions` array — the middleware does not care about the role code.

---

## 12.3 Tenant Isolation

A user belonging to **Tenant A must never access Tenant B**.

Enforced **server-side** only:

1. `tenantId` is taken from the **JWT**, never from body / query / URL.
2. `tenantMiddleware` attaches `req.tenantId`.
3. Mongoose plugin adds `{ tenantId: req.tenantId }` on every find/update/aggregate (except `tenants` collection and Platform Admin subscriber list).
4. Cross-tenant ids return **404**, not 403.

Platform Admin listing subscribers is the only cross-tenant read. Impersonate copies that merchant’s `tenantId` into the session; after exit, JWT has no merchant tenant.

---

## Backend middleware

```
auth → tenant → requirePermission('orders.view') → vendorScope → handler
```

```js
router.get('/', auth, tenant, requirePermission('orders.view'), vendorScope('orders'), listOrders);
router.post('/:id/cancel', auth, tenant, requirePermission('orders.cancel'), cancelOrder);
router.post('/labels', auth, tenant, requirePermission('shipping.generate'), vendorScope('orders'), createLabel);
```

Vendor scope: `assignedVendorIds` on the user. Miss → 404.

Files: `apps/backend/src/middleware/{auth,tenant,requirePermission,vendorScope}.js`.

---

## Frontend

- Sidebar and `ProtectedRoute` hide/block screens using `ROUTE_PERMISSION` + `user.permissions`.
- This is convenience. Repeating the same key on the API is mandatory.

---

## Adding keys later

1. Add the string to `PERMISSIONS` / role seed.
2. Call `requirePermission('new.key')` on the route.
3. No new role enum required unless you want a preset.
