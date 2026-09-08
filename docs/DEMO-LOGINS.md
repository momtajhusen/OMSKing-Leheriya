# OMSKing login details (dummy UI)

These accounts are for local / demo login only. They are **not shown on the login page**.

Password for every account: `password123`

| Role | Email | Opens |
|---|---|---|
| Platform Admin (SaaS owner) | `platform@omsking.com` | `/platform` — all subscribers |
| Merchant Super Admin | `superadmin@omsking.com` | `/dashboard` — Leheriya only |
| Operations | `ops@leheriya.com` | `/dashboard` — orders, fulfilment, shipping, vendors |
| Vendor | `vendor@omsking.com` | `/vendor/orders` — assigned rows only |

Access is permission keys (`orders.view`, …), not the role label. Tenant A cannot open Tenant B.

App: http://localhost:5173/auth/login
