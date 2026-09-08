# Domain rules — OMSKing (from Leheriya master spec)

Leheriya is **tenant configuration**, not `if (merchant === 'Leheriya')` in code.  
Functional benchmarks from public OMS/shipping products are **capabilities**, not UI clones.

Locked implementation stack stays **React + Express + MongoDB** (`docs/01-TECH-STACK.md`). Spec PDFs also mention NestJS/PostgreSQL — those are **not** adopted. Redis locks, BullMQ, and Socket.IO stay planned for inventory/jobs/realtime phases.

---

## Source of truth (non-negotiable)

| Internal master | Marketplace IDs |
|-----------------|-----------------|
| Master SKU | Shopify variant / Amazon SKU+ASIN / Myntra catalog id |
| Logical warehouse (WH-001, WH-002, …) | Shopify location, Amazon warehouse, Myntra warehouse |
| Master Order (one per channel order) | Channel order id (unique with tenant + channel) |
| Inventory ledger | Never a single overwritten qty |

Adapters: Core OMS ← Shopify / Amazon / Myntra adapters. Future channels plug in without redesigning masters.

---

## Warehouses & available-to-sell

Explicit mapping (not “a Shopify location = a warehouse”):

| Internal WH | Channel location | Shopify | Amazon | Myntra |
|-------------|------------------|---------|--------|--------|
| WH-001 shared / physical | Shopify Location A | yes | yes | yes |
| WH-002 Shopify-only / virtual | Shopify Location B | yes | **no** | **no** |
| WH-001 | Amazon inventory | n/a | yes | n/a |
| WH-001 | Myntra inventory | n/a | n/a | yes |

ATS:

- Shopify = WH-001 + WH-002 (for SKUs stocked in both)
- Amazon = WH-001 only
- Myntra = WH-001 only

Example: physical 4 + virtual 1000 → Shopify 1004, Amazon 4, Myntra 4.

---

## Inventory authority (tenant setting)

Configurable, not hard-coded:

1. **OMS is master** — adjustments in OMS push to Shopify, Amazon, Myntra.
2. **Shopify is master** — WH-001 stock is read from Shopify Location A; OMS panel does not allow sellable qty edits; changes flow to Amazon + Myntra.

Reservation: on accepted order, lock qty at Master SKU + warehouse. Concurrent two orders for last unit: one reserved, one out of stock. Never negative sellable. MongoDB transactions (replica set) for the lock; Redis lock later if multi-instance.

Ledger: tenant, SKU, warehouse, qty, before/after, type, reason, order id, channel, user/system, timestamp. Immutable.

---

## Master Order

One marketplace order = one Master Order (`MO-…` / `OMS-ORD-…`). Shopify Location A vs B must **not** duplicate the customer order. Internal **fulfillment groups** (and multiple shipments) are allowed under that one Master Order (WH + vendor split, qty>1 vendor split).

Partial cancel / split ship does not create a second Master Order.

Label cancel on Shopify: fulfilled → unfulfilled (marketplace update via adapter).

Vendor dispatch may happen without waiting for “delivered from vendor”.

---

## Order state machine (design)

Main: `NEW` → payment status → `INVENTORY_RESERVED` → `PROCESSING` → pick → pack → `AWB_GENERATED` → `SHIPPED` → in transit → OFD → `DELIVERED`.

Exceptions (same Master Order): cancelled, payment failed, out of stock, vendor pending/accepted/rejected, NDR, RTO, return requested/picked/received, QC pass/fail, refund, exchange.

Who may cancel is `orders.cancel`, and only in allowed stages (release reservation, cancel AWB if needed, push channel).

---

## Shipping / reverse

Courier master, credentials (encrypted, never in frontend or plain logs), rate card, pincode serviceability, AWB, labels (single + bulk), cancel, retry, manifest + pickup, tracking events, status pushback.

NDR: reason, attempt, customer action, reattempt, address/phone fix.  
RTO: reason, return tracking, receipt, QC, restock.  
Returns: request, approve, return label, pickup, **on Received → inventory/restock popup**, refund/exchange/restock.

Courier **invoice** reconciliation is separate from marketplace settlement (weight, COD, RTO, NDR, surcharge mismatches).

---

## GST / finance (architecture even if UI is later)

GST-ready sales/returns: B2B vs B2C, taxable, CGST/SGST/IGST/cess, credit/debit notes, export for Tally/Busy (phase). Shopify GST invoice number = Order ID (Leheriya config). Partially paid = COD until money lands.

Settlement: expected net (gross − commission − shipping − fees − TCS/TDS − refunds) vs actual. Exceptions: type, amount, order, channel, assignee, notes.

---

## Reliability & security

- Idempotency keys on reserve / order ingest / webhooks (`X-Idempotency-Key` + unique channel order id).
- Duplicate webhook → no second order, no second reservation.
- Retry + exponential backoff, dead-letter, correlation id, webhook history + manual retry.
- JWT + refresh cookie, optional 2FA, `requirePermission(key)`, tenant from JWT only.
- Channel/courier/messaging secrets encrypted at rest, rotatable, tenant-scoped.

---

## Platform Admin screens (SaaS, not packing)

Dashboard, tenants, plans, platform users, **integration health**, **system jobs**, **error logs**, support impersonation, platform settings.

---

## UAT that the data model must support

1. Stock=1, two simultaneous channel orders → one reserve, one OOS.  
2. Same webhook twice → one Master Order.  
3. Shopify order edit → Master Order + reservation adjust.  
4. Vendor reject → reason + reassign.  
5. Label cancel → Shopify unfulfilled.  
6. Return received → QC → refund/exchange/restock.  
7. Tenant A never sees Tenant B.  
8. Channel API down → recorded, retry, no duplicate txn.

---

## Notifications

Event → rule (channel + recipient + enabled) → delivery `queued | sent | delivered | failed` with retry.
