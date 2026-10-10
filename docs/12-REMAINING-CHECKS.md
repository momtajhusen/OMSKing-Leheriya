# Baaki checks — OMSKing

Pehle wala kaam: `docs/11-ROLE-COMPLETION-PHASES.md` Phase 1–9. Woh dubara mat kholo.  
Agreement: `docs/Leheriya_OMS_Final_Combined_Agreement.pdf`  
Yeh live delivery nahi hai. Keys mat maango. Live Delhivery, Shopify fulfill, Amazon ship, Myntra, inventory push mat chalao. Test injected HTTP se.

Ek chat = **ek phase**. Naya layout mat banao. `tenantId` body/query se mat lo. Naya role mat jodo.

| Mark | Matlab |
|---|---|
| DONE | Phase 1–9 ya uska test yeh cover karta hai. Dubara mat likho. |
| CHECK | Screen ya rule abhi exit test mein nahi tha. Kholo. Toota ho to sirf woh. |

---

## Jo ho chuka hai — mat chhedo

- Catalog, warehouse, order-in, fulfilment split, shipping payment (partial = COD, Void), return / RTO / NDR, reconciliation, GST PDF, platform vs merchant isolation, audit append-only.
- Vendor desk: sirf apni lines, Accept / Reject + reason, dubara assign, ek parcel ek tracking. `tests/phase8.test.js`.
- Notification ka yeh hissa: NOT-002 telegram tabhi jab switch on ho. NOT-001 email / WhatsApp / Telegram alag switch. Band event par message nahi. Doosri baar same send id. Bot token, Gmail password, WhatsApp token response mein wapas nahi. `tests/phase8.test.js`.

---

## Phase A — Vendor (baaki)

**CHECK**

1. Vendor login `/vendor/orders`. Merchant `     /dashboard`, `/fulfilment`, `/users-roles`, `/payment-reconciliation` na khule.
2. Grid simple ho: tracking, courier, dispatch date, delivery date. Save par accepted line dispatch ho.
3. Kai rows select. Ek tracking sab par. Alag vendor ki line list mein na aaye.
4. Settings par Telegram group id save ho. Assign par message usi group par jaye, owner chat par nahi, jab NOT-002 telegram on ho.
5. 7 din bina dispatch: NOT-010. WhatsApp text “Please dispatch this item urgently”. Switch off ho to message na jaye.

**Exit:** vendor A, vendor B ki line na dekhe. Bulk tracking ek number. NOT-010 off par koi send nahi.

**Files:** `VendorOrdersPage.jsx`, `VendorSettingsPage.jsx`, `notify.service.js` (`scanOverdueDispatches`).

---

## Phase B — Platform (baaki)

**CHECK**

Phase 9 yeh kar chuka hai: `/platform`, packing desk nahi, Leheriya Surat Silks nahi dekhta, permission key, secrets UI par nahi, audit edit/delete nahi.

Ab yeh screens:

1. `/platform/tenants` — naya subscriber, suspend, Open tenant, Back to platform. Open ke baad packing us merchant ka. Exit par wapas `/platform`, merchant data session mein na rahe.
2. `/platform/plans` — plan save. Merchant trial 14 din ke baad sign-in rukhe. Yeh rule `tests/tenantCredentials.test.js` mein hai. Screen par wahi plan dikhe.
3. `/platform/demo-requests` — request account na banaye. `tests/demoRequest.test.js`.
4. `/platform/users` — platform staff. Merchant user is list mein na aaye.
5. `/platform/health`, `/platform/jobs`, `/platform/logs` — last sync, failed job, retry. Retry doosri reserve na kare. Token ya webhook secret row mein na dikhe.

**Exit:** suspend tenant login na kare. Impersonate ke baad exit par Leheriya orders platform list mein mix na hon.

**Files:** `PlatformPlansPage.jsx`, `DemoRequestsPage.jsx`, `PlatformStaffPage.jsx`, `PlatformOpsPage.jsx`, `tenants.controller.js`.

---

## Phase C — Notification (baaki)

**CHECK**

Har event ka switch alag hai. Ek on karne se baaki on na hon.

| Id | Kab | Check |
|---|---|---|
| NOT-003 | Dispatch | Email / Telegram / WhatsApp sirf jab woh channel on ho |
| NOT-004 | Shipping status | Wahi |
| NOT-005 | Delivered | Wahi. NOT-004 ke saath ek hi message do baar na jaye |
| NOT-006 | Return | Wahi |
| NOT-007 | Low stock | Wahi |
| NOT-008 | Job fail | Wahi. Customer ko na jaye |
| NOT-009 | Vendor assign par owner | Switch locked on. Owner ko jaye, vendor group alag rahe |
| In-app | `other` on | Bell / notifications page par row. Off par row na bane |

Screen `/notifications`: token field khali dikhe jab saved ho. “Leave blank to keep” ke alawa purana token text mein na ho.

**Exit:** NOT-003 on, NOT-004 off. Dispatch par ek message. Shipping change par usi order ka NOT-004 message zero. Injected mailer / telegram. Live Telegram ya WhatsApp mat chalao.

**Files:** `notify.service.js`, `NotificationsPage.jsx`, `tests/phase8.test.js` extend.

---

## Phase D — Agreement ki baaki screens

**CHECK**

Phase 1–9 ke exit mein yeh nahi the.

1. Orders par **All Orders** tab. Status tab ke saath. Cancelled bhi is tab mein.
2. Cancel ke baad order dubara unfulfilled ho to status **New**. Alag lost state mein na atke.
3. Dashboard counts: New, Processing, Pending, Dispatched, Delivered. Cancelled net sales mein na jude.
4. `/reports` — sales / orders isi tenant ke. Doosre tenant ka number na aaye.
5. `/integrations` — failed job dikhe, Retry dabane par naya reserve na bane.
6. Forgot password + reset. OTP sirf us company ke Gmail se. Doosri company ka mailbox use na ho.
7. Settings → Company. GSTIN save. Audit mein before/after. GSTIN ke alawa password field na ho.

**Exit:** All Orders mein cancelled dikhe. Unfulfilled-again order New tab mein ho. Reports mein sirf current tenant.

**Files:** `OrdersPage.jsx`, `DashboardPage.jsx`, `ReportsPage.jsx`, `IntegrationManagementPage.jsx`, `auth.controller.js`, `SettingsPage.jsx`.

---

## Is list mein nahi

Live channel call, Hostinger, GitHub handover, Purchase, FAQ/Tickets, Flipkart, Meesho, AJIO, Nykaa, extra courier, Tally API, SaaS billing.
