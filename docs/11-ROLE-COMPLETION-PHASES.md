# Role completion phases — OMSKing

Ek chat = **ek phase**. Us phase ka exit test pass ho, tab agla phase. Beech ka phase mat chhedo.

Agreement: `docs/Leheriya_OMS_Final_Combined_Agreement.pdf`  
Pehle se bana hua integration: `docs/10-INTEGRATION-BUILD-PLAN.md`  
Domain: `docs/08-DOMAIN-RULES.md`  
Roles: `docs/04-RBAC-BLUEPRINT.md`

Stack wahi: React + Express + MongoDB. Naya layout mat banao. `tenantId` body/query se mat lo.

| Mark | Matlab |
|---|---|
| VERIFY | Code hai. Dubara mat likho. Test chalao. Test fail ho to sirf woh bug. |
| BUILD | Yeh abhi agreement ke hisaab se poora nahi hai. Sirf yeh banao. |

Live Delhivery, Shopify fulfill, Amazon ship, Myntra RTD/inventory, ya inventory push **mat chalao**. Test injected HTTP se. Phase 10 tab, jab user keys de.

---

## Phase 1 — Catalog Manager

**VERIFY**

1. Ek product variant = ek Master SKU.
2. Shopify, phir Myntra, phir Amazon. Same seller SKU ya barcode auto-map.
3. Match na ho to Unmapped. Stock row na bane.
4. Naye tenant par import ka order: Shopify → Myntra → Amazon.

**Exit:** teen channels par same kurta = 1 Master SKU + 3 mapping rows. Bina barcode wala SKU Unmapped.

**Files:** `catalogPull.service.js`, `catalogMapping.service.js`, `SkuMappingPage.jsx`, `ProductImportPage.jsx`, `tests/catalog.test.js`.

---

## Phase 2 — Warehouse

**VERIFY**

1. WH-001 physical, sab channels, pickup.
2. WH-002 virtual, sirf Shopify, pickup nahi.
3. Stock in/out ledger. Available = on hand − reserved. Ek number overwrite nahi.
4. Reserve se available kam. Restock ke baad channel ATS push job queue (live push nahi).

**Exit:** physical 4 + virtual 1000. Shopify 1004. Amazon 4. Myntra 4. 1 reserve ke baad Amazon 3, Location B 1000.

**Files:** `warehouse.service.js`, `inventory.service.js`, `inventoryPush.service.js`, `tests/phase4.test.js`.

---

## Phase 3 — Operations: order in

**VERIFY**

1. Ek channel order = ek Master Order. Doosri baar naya order nahi.
2. Mapped line reserve. Unmapped reserve nahi, order Unfulfillable nahi (marketplace status rehta hai), `reserveState = unmapped`.
3. Shopify location B → WH-002. Baaki plan WH-001 pehle.
4. Stock 1, do orders: ek reserved, ek out of stock. Ledger mein ek `order_reserve`.
5. Qty change: purana hold release, naya hold. Cancel: hold release.
6. Webhook tab order banaye jab `line_items` hon.

**Exit:** `tests/phase3-gap.test.js` + `tests/phase1.test.js` (webhook bina line items order na banaye).

**Files:** `orderReserve.service.js`, `channelOrder.service.js`, `adapters/shopify/index.js`, `jobQueue.service.js`.

---

## Phase 4 — Operations + Vendor: fulfilment

**VERIFY**

1. Sabse purana open order pehle WH-001.
2. WH-001 khatam to agla order vendor line. Amazon/Myntra out of stock bhi vendor line, Unfulfillable nahi.
3. Qty WH-001 se zyada: ek Master Order, pehle units Offline, baaki Virtual. Mixed pack tab aur vendor tab dono par.
4. Unmapped open line On Hold. Action: Map SKU.
5. Vendor sirf apni lines. Accept / Reject. Reject par reason, woh slice release, line dubara assign.
6. Ek parcel, kai orders: ek tracking sab par.
7. Assign par Telegram sirf jab NOT-002 telegram on ho.

**Exit:** `tests/orderDesk.test.js` + vendor assign test (`tests/phase8.test.js`). UI par Reject clip na ho.

**Files:** `orderDesk.service.js`, `FulfilmentPage.jsx`, `VendorOrdersPage.jsx`, `notify.service.js`.

---

## Phase 5 — Operations: shipping + payment mode

**BUILD** (baaki VERIFY)

VERIFY:

1. Shopify label = Delhivery. Amazon/Myntra par Delhivery call nahi.
2. Label cancel → order New, Shopify unfulfilled, reserve tab tak jab tak order khud cancel na ho.
3. Pickup tab jab token + pickup warehouse name ho.

BUILD:

1. **Partially Paid = COD** fulfilment par. Delhivery `payment_mode` COD. Screen par “Partially paid, handled as COD”. Paisa aane tak paid nahi.
2. **Void** payment mode sync. Shopify `financial_status = voided` → Void. Fulfilment COD jaisa mat chalao.

**Exit:** injected book request. Partially paid body mein `COD`. Void order Delhivery COD na ho. `tests/phase5.test.js` green.

**Files:** `adapters/shopify/index.js` (`shopifyPayment`), `orderDesk.service.js`, `ship.service.js`, `adapters/couriers/delhivery/index.js`.

---

## Phase 6 — Customer Support + Warehouse: return, RTO, NDR

**VERIFY**

1. Delivered scan wahi Master Order.
2. NDR se naya order nahi. Reattempt ya RTO usi order par.
3. RTO ek baar `rto_restock`. Doosri baar stock double nahi. Items khali hon to skip.
4. Return approve: Delhivery pickup tab jab `apiToken` + `pickupWarehouse` + pincode ho. Warna `RET-{returnNo}`.
5. Receive restock: All / Shopify / Amazon / Myntra / None. Push sirf chune hue channels.

**Exit:** `tests/phase6.test.js` + phase3 RTO/return-label test.

**Files:** `tracking.service.js`, `returnsFlow.service.js`, `orderReserve.service.js`.

---

## Phase 7 — Accounts: reconciliation

**BUILD**

1. Shopify: Paid aur Cancelled list se bahar.
2. Fulfilled + payment Unpaid + purana (30 din) → Reconciliation par flag. Fulfilled ko Paid mat samjho.
3. Partially Paid yahi unpaid list mein, jab tak mark paid na ho.
4. Amazon/Myntra payment CSV → match “Payment Received”, exception alag.
5. **Return file CSV** upload → match “Return Received”. Payment file se mat milao.
6. Courier bill alag: charged weight > declared = exception. Settlement mein mat gholo.

**Exit:** `tests/phase7.test.js` extend. Paid Shopify delivered list mein na aaye. Ek return-file row ek Master Order par “Return Received”.

**Files:** `finance.service.js`, `finance.controller.js`, `PaymentReconciliationPage.jsx`, `ReturnsRefundsReconciliationPage.jsx`.

---

## Phase 8 — Accounts: GST invoice

**BUILD**

1. Shopify invoice number = channel order id.
2. CGST+SGST agar warehouse state = ship-to state, warna IGST.
3. Credit note `CN-{invoice}`.
4. **PDF preview**, print/download. Email tab jab company mailbox configured ho. Mail na ho to PDF phir bhi download ho.
5. Tally = CSV export. Tally API nahi.

**Exit:** ek order ka PDF bytes `%PDF` se shuru. Intra-state par IGST 0. Email skip jab Gmail na ho.

**Files:** `GstInvoicePage.jsx`, naya invoice PDF helper backend par, `finance.service.js` (`invoiceNumber`, `lineTax`).

---

## Phase 9 — Platform Admin + Merchant Super Admin

**VERIFY**

1. Platform Admin `/platform`. Merchant packing desk nahi.
2. Merchant Super Admin sirf apna tenant. Surat Silks Leheriya nahi dekhe.
3. Roles permission key se, role name se nahi. Vendor ko `users.manage` / `finance.reconcile` nahi.
4. Channels, webhook secret, courier token UI par wapas na aaye.
5. Audit: user, action, time, before/after. Row edit/delete na ho.

**Exit:** `tests/phase4.test.js` tenant isolation + `tests/tenantCredentials.test.js`.

**Files:** `tenantPlugin`, `UsersRolesPage.jsx`, `auditLog.service.js`. Naya role mat jodo.

---

## Phase 10 — Live (user bole tab)

Code phase 1–9 ke baad. Keys user de. Bina bole API mat chalao.

1. Stock 1, do orders, ek reserve, ek out of stock.
2. Duplicate webhook, ek Master Order.
3. Shopify edit, wahi order, reservation adjust.
4. Vendor reject, line dubara assign.
5. Label cancel, Shopify unfulfilled.
6. Return receive, restock, ATS push.
7. Tenant A, Tenant B nahi dekhe.
8. Channel down, job fail, retry, doosri reserve nahi.

Is list mein nahi: Flipkart, Meesho, AJIO, Nykaa, extra courier, Tally API, platform billing, Purchase, FAQ/Tickets.
