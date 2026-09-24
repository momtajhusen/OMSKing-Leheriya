# OMSKing login details

Password for every seeded account: `password123`

Accounts are created in Mongo by `make seed`. They are **not shown on the login page**.

| Role | Email | Opens |
|---|---|---|
| Platform Admin (SaaS owner) | `platform@omsking.com` | `/platform` — all subscribers |
| Merchant Super Admin | `superadmin@omsking.com` | `/dashboard` — Leheriya only |
| Operations | `ops@leheriya.com` | `/dashboard` |
| Vendor | `vendor@omsking.com` | `/vendor/orders` |
| Other-tenant Super Admin | `ravi@suratsilks.com` | `/dashboard` — Surat Silks only (isolation check) |

Access is permission keys (`orders.view`, …), not the role label. Tenant A cannot open Tenant B.

App: http://localhost:5173/auth/login  
API: http://localhost:5002/api/v1

Gmail (account invite password + reset OTP): set `GMAIL_USER` and `GMAIL_APP_PASSWORD` in `apps/backend/.env`, then restart the backend. Use a Google **App Password**, not the normal Gmail password.
