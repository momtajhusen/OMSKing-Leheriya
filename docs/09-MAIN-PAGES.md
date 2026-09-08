# OMSKing — main pages (business connection)

Leheriya ka **asli pipe** yeh hai: marketplace se order aata hai → Master SKU + warehouse stock lock hota hai → **ek Master Order** → pack/vendor → AWB → delivery ya reverse → paise + GST.

Neeche **isi pipe ke order** mein pages hain (category-wise). Pehle wale zyada important hain. Dummy UI abhi; live API baad mein.

Login: `docs/DEMO-LOGINS.md`  
Domain rules: `docs/08-DOMAIN-RULES.md`

---

## Spine (ek line)

```
Channels → Catalog (Master SKU / map / import)
        → Warehouses + Inventory (ATS + reserve)
        → Orders (Master Order)
        → Fulfilment (WH-001 pack  |  vendor split)
        → Shipping (Shopify courier  |  Amazon/Myntra courier)
        → NDR → RTO → Returns
        → GST + marketplace recon + courier recon
```

Vendor apna **Excel-style** panel isi Master Order ke assigned lines par kaam karta hai — alag dusra order nahi.

---

## 1. Daily ops (sabse important)

| # | Page | Path | Connection |
|---|------|------|------------|
| 1 | **Orders** | `/orders` | Har Shopify / Amazon / Myntra order = **ek Master Order**. Channel tabs, All Orders, Partially paid = COD, cancel → Unfulfilled → New. |
| 2 | **Dashboard** | `/dashboard` | New / Processing / Pending / Dispatched / Delivered — bina list khole pulse. |
| 3 | **Fulfilment** | `/fulfilment` | Offline stock → WH-001 pack. Virtual / OOS → vendor lines (qty>1 split). Reject + reassign. |
| 4 | **Shipping** | `/shipping` | Shopify: khud ke courier, AWB, bulk label, manifest, pickup. Label cancel → Shopify unfulfilled. Amazon/Myntra: marketplace courier. |
| 5 | **Vendors** (admin) | `/vendors` | Vendor + Telegram group. Order yahan se assign. |

---

## 2. Vendor portal (same Master Order, restricted)

| # | Page | Path | Connection |
|---|------|------|------------|
| 1 | **Vendor orders** | `/vendor/orders` | Accept / reject, Excel sheet, **bulk tracking** ek parcel. |
| 2 | **Vendor shipping** | `/vendor/shipping` | Dispatch / AWB jo vendor fill kare. |
| 3 | **Vendor returns** | `/vendor/returns` | Unke assigned reverse. |
| 4 | **Vendor products** | `/vendor/products` | Sirf unka catalog slice. |
| 5 | **Vendor dashboard** | `/vendor/dashboard` | Pending accept / dispatch counts. |
| 6 | **Vendor settings** | `/vendor/settings` | Profile, not tenant GST. |

---

## 3. Stock (Orders se pehle lock, baad mein restock)

| # | Page | Path | Connection |
|---|------|------|------------|
| 1 | **Inventory** | `/inventory` | WH-001 all channels, WH-002 Shopify only. Reserved + **movements ledger**. Kabhi ek overwritten qty nahi. |
| 2 | **Warehouses** | `/warehouses` | Location map: Shopify A = WH-001; Shopify B = WH-002; Amazon/Myntra = WH-001. |
| 3 | Settings → **Inventory source** | `/settings` | OMS master vs Shopify Location A master (tenant config). |

---

## 4. Catalog (bina iske mapping / ATS galat)

| # | Page | Path | Connection |
|---|------|------|------------|
| 1 | **Master SKU** | `/master-sku` | Internal identity — orders, stock, vendors, shipping isi par. |
| 2 | **SKU Mapping** | `/sku-mapping` | Channel SKU ↔ Master SKU. Unmapped / Failed / Unlisted. |
| 3 | **Bulk import** | `/import` | Naya tenant: Shopify → Myntra → Amazon; same SKU auto-map. |
| 4 | **Products** | `/products` | Variants, HSN/GST, images. Import yahan se bhi. |

---

## 5. Reverse logistics (same Master Order, naya order nahi)

| # | Page | Path | Connection |
|---|------|------|------------|
| 1 | **NDR** | `/ndr` | Fail reason, attempts, phone/address fix, reattempt ya RTO. |
| 2 | **RTO** | `/rto` | Return-to-origin, QC, restock destination. |
| 3 | **Returns** | `/returns` | Approve, **return label**, Received → inventory popup, restock All / Shopify / Amazon / Myntra / None. |

---

## 6. Finance (paise + tax — order ke baad)

| # | Page | Path | Connection |
|---|------|------|------------|
| 1 | **GST Invoice** | `/gst-invoice` | Shopify invoice no. = Order ID. CGST/SGST/IGST, credit/debit notes, Tally/Busy export. |
| 2 | **Payments** | `/payment-reconciliation` | Amazon/Myntra files. Shopify: Fulfilled+Unpaid ageing. **Courier invoice recon alag.** Partially paid = COD. |
| 3 | **Refunds recon** | `/returns-refunds-reconciliation` | Return/refund vs expected. |
| 4 | **Reports** | `/reports` | Sales / channel / courier — pehle daily nahi, baad mein. |

---

## 7. Channel pipes (order yahan se andar aata hai)

| # | Page | Path | Connection |
|---|------|------|------------|
| 1 | **Channels** | `/channels` | Shopify / Amazon / Myntra keys + warehouse attach. |
| 2 | **Integrations** | `/integrations` | Last sync, failed jobs, retry. |
| 3 | **Webhooks** | `/webhooks` | Duplicate webhook = **dusra Master Order nahi**. Retry / dead-letter. |

---

## 8. Setup + control (har din nahi, bina iske isolation toot'ti hai)

| # | Page | Path | Connection |
|---|------|------|------------|
| 1 | **Settings** | `/settings` | Company, GSTIN, couriers (rate + pincode), tax, inventory authority. |
| 2 | **Users & Roles** | `/users-roles` | Super Admin / Ops / Warehouse / Accounts / Catalog / Support / Vendor. |
| 3 | **Notifications** | `/notifications` | Event on/off — Telegram / Email / WhatsApp. Vendor group on assign. |
| 4 | **Audit logs** | `/audit-logs` | Who changed what (before/after). |
| 5 | **Authentication** | `/authentication` | Sessions, reset, API keys, optional 2FA. |

---

## 9. SaaS platform (merchant packing desk nahi)

| # | Page | Path | Connection |
|---|------|------|------------|
| 1 | **Overview** | `/platform` | Subscribers, impersonate. |
| 2 | **Subscribers** | `/platform/tenants` | Onboard + **bulk import** step. Tenant A ≠ Tenant B. |
| 3 | **Plans** | `/platform/plans` | Starter / Growth / Enterprise. |
| 4 | **Platform users** | `/platform/users` | OMSKing staff. |
| 5 | **Health / Jobs / Logs** | `/platform/health` `/jobs` `/logs` | Adapter down, retry, no duplicate reserve. |
| 6 | **Platform auth / settings** | `/platform/auth` `/platform/settings` | Cross-tenant sessions, flags. |

---

## 10. Public + login (product baahar, OMS andar)

| Page | Path |
|------|------|
| Home / Features / Pricing / About / Contact | `/` `/features` `/pricing` `/about` `/contact` |
| Login / Register / Forgot / Reset | `/auth/login` … |

Pehle tenant **Leheriya**; brand **OMSKing**. Marketing par Platform Admin nahi — woh alag login.

---

## Roz ka walk (ops)

1. `/dashboard` — kya atka  
2. `/orders` — Master Order kholo  
3. `/inventory` — reserved / ATS  
4. `/fulfilment` — pack ya vendor  
5. `/vendor/orders` — vendor sheet + bulk AWB  
6. `/shipping` — label / manifest  
7. `/ndr` → `/rto` → `/returns` agar reverse  
8. `/gst-invoice` + `/payment-reconciliation` jab paise

Catalog (`/master-sku` → `/sku-mapping` → `/import`) **pehle setup**, roz kam. Channels/webhooks **hamesha running** background.

---

## Jo is list mein “main pipe” nahi

- `/ui/showcase` — design kit, business nahi  
- Purchase / PO, FAQ, Tickets — agreement ke **23 modules** mein nahi  
- NestJS / PostgreSQL — stack lock: React + Express + Mongo
