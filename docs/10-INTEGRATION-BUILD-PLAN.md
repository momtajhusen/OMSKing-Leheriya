# Integration phases — finish OMSKing

Phase 0–4 (UI, login, catalog CRUD, inventory engine) ho chuka hai. Unhe dubara mat banana.

Neeche **Phase 1 se Phase 8** third-party APIs ka kaam hai. Ek phase ka exit test pass hone ke baad hi agla phase shuru karo.

| Phase | Kaam | Screen |
|---|---|---|
| 1 | Queue, webhook inbox, adapter shell | `/integrations` `/webhooks` |
| 2 | Catalog live sync | `/master-sku` `/sku-mapping` |
| 3 | Orders in + stock reserve | `/orders` `/dashboard` |
| 4 | Stock wapas channel par | `/inventory` |
| 5 | AWB, label, marketplace ship | `/fulfilment` `/shipping` `/vendor/orders` |
| 6 | Tracking, NDR, RTO, returns | `/ndr` `/rto` `/returns` |
| 7 | GST + settlement files | `/gst-invoice` `/payment-reconciliation` |
| 8 | Telegram alert | `/notifications` |

Screens pehle se bani hain. Har phase sirf dummy data hata kar API lagata hai. Stack wahi rahega: React + Express + MongoDB.

---

## Phase 1 — Queue, webhook inbox, adapter shell

**Pehle yeh ready ho**

| Cheez | Detail |
|---|---|
| Design | `/integrations` aur `/webhooks` shells. Naya layout nahi. |
| Backend | Channel credentials save + encrypt ho chuka hai (`credentialsEnc`). Decrypt server par. Token React ko kabhi mat bhejo, log mein kabhi mat likho. |
| Database | MongoDB **replica set** ya Atlas. Standalone `mongod` reserve ko atomic nahi kar sakta. |
| Env | `MONGODB_URI` (replica set), `CHANNEL_ENCRYPTION_KEY`, `REDIS_URL`, aur ek public HTTPS URL. Webhook `localhost` par nahi aata. |
| Credentials | Is phase mein live Shopify/Amazon token zaroori nahi. Fake webhook se test karo. |

**Banana hai**

- Folder `apps/backend/src/adapters/shopify`, `amazon`, `myntra`, `couriers/delhivery`. HTTPS call sirf adapter kare.
- Redis + BullMQ. Job types: `orders_pull`, `inventory_push`, `webhook_dispatch`.
- Collection `webhook_events`: tenant, channel, external event id, payload, status `received | processed | failed`. Unique `(tenantId, channel, externalEventId)`.
- Collection `integration_jobs`: type, channel, status, error, retry count.
- `POST /api/v1/integrations/:channel/webhook` — signature check, inbox row, queue, turant 200.
- Tenant webhook par signature / shop se aata hai, URL param se nahi.

**Exit test**

- Same webhook do baar. Ek row processed, doosri duplicate.
- Worker beech mein band karke restart. Job retry ho. Side effect do baar na chale.

---

## Phase 2 — Catalog live sync

**Pehle yeh ready ho**

| Cheez | Detail |
|---|---|
| Design | `/sku-mapping` aur `/import`. CSV import fallback rehne do. |
| Backend | Phase 1 adapter shell. Master SKU + mapping CRUD (Phase 3) jaisa hai. |
| Order | Shopify pehle, phir Myntra, phir Amazon. Pehla channel Master SKU banata hai. Baad wale barcode ya SKU se auto-map. |

**Credentials**

Shopify custom app:

| Field | Kahan se |
|---|---|
| Shop URL | `*.myshopify.com` |
| Client ID, Admin token `shpat_…`, API secret `shpss_…` | Custom app |
| Location A | WH-001. `shopify-location-a` hata kar asli id |
| Location B | WH-002 |
| Scopes | `read_products`, `read_inventory` |

Amazon SP-API (MWS nahi):

| Field | Kahan se |
|---|---|
| Seller ID | Seller Central |
| Marketplace ID | India `A21TJRUUN4KGV` |
| LWA client id + secret, refresh token, app id | Developer Console + Seller Central authorize |
| Roles | Listings / Catalog |

Myntra PPMP:

| Field | Kahan se |
|---|---|
| Merchant Id, secret key, PPMP token, Store Id | Myntra partner team |
| Warehouse code | Aksar Store Id jaisa |
| API host | Default `https://api.pretr.com` |

`/channels` par save karo. Git aur `.env` mein token mat daalo.

**Banana hai**

- Shopify products + variants pull → Master SKU + `sku_mappings`. Location A/B `warehouse_location_maps` par.
- Amazon listings (SKU + ASIN). Barcode ya seller SKU se match, warna `unmapped`.
- Myntra catalog, wahi match rule.

**Exit test**

- Ek kurta jo teenon channels par hai = ek Master SKU + teen mapping rows.
- Jis SKU ka barcode nahi aur match nahi, woh `unmapped` rahe. Stock row na bane.

---

## Phase 3 — Orders in + reserve

**Pehle yeh ready ho**

| Cheez | Detail |
|---|---|
| Design | `/orders`, `/dashboard`. Mock orders hatao. |
| Backend | Phase 2 mappings. `reserveStock` pehle se hai. |
| Data | Opening stock ledger se: WH-001 physical, WH-002 virtual. Ek “available” number mat likho. |
| Data | Har selling variant ka Master SKU. Unmapped line reserve nahi karegi. |
| Company | GSTIN, pickup address, inventory authority `oms` ya `shopify`. |

**Credentials (Phase 2 ke alawa)**

| Channel | Extra |
|---|---|
| Shopify | Webhook secret. Scopes `read_orders`, `write_orders`. COD names, jaise `COD, Cash on Delivery`. `importOrdersFrom` date. |
| Amazon | Orders role. `importOrdersFrom`. |
| Myntra | Orders access. `importOrdersFrom`. |

**Banana hai**

Ek order service, teeno adapters use karein.

1. Webhook ya pull verify.
2. `(tenant, channel, channelOrderId)` pehle se ho to update. Naya Master Order mat banao.
3. Line → Master SKU. Unmapped ho to flag `mapping_failed`, reserve nahi, `/orders` par dikhe.
4. Shopify Location B → WH-002. Baaki → WH-001. Location A aur B **ek** Master Order, do fulfillment groups.
5. `reserveStock`, idempotency key = channel + order id + line.
6. Status `NEW` → `INVENTORY_RESERVED` ya `out_of_stock`.
7. COD = Shopify gateway list, ya Amazon/Myntra COD. Partially paid = COD jab tak paisa na aaye.
8. Raw JSON `sourceOrderData` par rakho. UI us blob se rule na chalaye.
9. Scheduled pull `importOrdersFrom` se, taaki missed webhook bhi aa jaye.
10. Cancel webhook → reservation release. Qty edit → usi order par reservation adjust.

Pehle sirf Shopify. Teen exit tests pass, phir Amazon, phir Myntra.

**Exit test**

- Stock 1, do orders ek saath. Ek reserve, ek out of stock. Ledger mein ek `order_reserve`.
- Same webhook do baar. Ek Master Order.
- Shopify order edit. Wahi order, reservation badli, doosra order nahi.

---

## Phase 4 — Stock wapas channel par

**Pehle yeh ready ho**

| Cheez | Detail |
|---|---|
| Design | `/inventory`. ATS screen pehle se hai. |
| Backend | Phase 3 reserve available qty kam karta hai. |
| Credentials | Shopify `write_inventory`. Amazon inventory role. Myntra inventory SLA days. |

**Rule**

| Channel | Qty |
|---|---|
| Shopify Location A | WH-001 available |
| Shopify Location B | WH-002 available |
| Amazon | Sirf WH-001 |
| Myntra | Sirf WH-001 |

**Banana hai**

- Jo ledger available qty badle, us SKU ka `inventory_push` job.
- Shopify per location set. Amazon quantity feed. Myntra inventory update.
- Agar `inventoryAuthority = shopify`: OMS edit band rehta hai. Job Location A padhe, WH-001 likhe, phir Amazon + Myntra push. Shopify ko OMS se push mat karo.

**Exit test**

- WH-001 = 4, WH-002 = 1000, reserved 0. Shopify Location A = 4, Location B = 1000. Amazon 4. Myntra 4.
- WH-001 par 1 reserve. Amazon 3. Shopify Location A 3. Location B waisi ki waisi.

---

## Phase 5 — AWB, label, marketplace ship

**Pehle yeh ready ho**

| Cheez | Detail |
|---|---|
| Design | `/fulfilment`, `/shipping`, `/vendor/orders`. |
| Backend | Phase 3 ka reserved in-stock order. |
| Data | WH-001 pickup address, pincode, phone. Kam se kam ek vendor agar vendor-fulfillment test karna ho. |

**Credentials — Delhivery (Shopify self-ship)**

| Field | Kahan se |
|---|---|
| API token | Delhivery seller account |
| Pickup warehouse name | WH-001 jaisa unke account par |
| Pickup pincode, phone, address | WH-001 |

Bluedart, Ecom, Xpressbees baad mein, jab Delhivery chal jaye. Ek din mein char courier mat shuru karo.

Amazon aur Myntra apna courier dete hain. Unke liye Easy Ship / partner “ready to ship” role. Un par Delhivery AWB mat banao.

**Banana hai**

Shopify + Delhivery:

1. Pincode serviceable hai ya nahi.
2. AWB + label PDF → `shipments`.
3. Din ka manifest + pickup, WH-001.
4. Shopify par fulfilled + tracking.
5. Label cancel → Delhivery AWB cancel **aur** Shopify unfulfilled. Order cancel ho to reserve release. Sirf relabel ho to reserve rakho.

Bulk label ek job hai, browser loop nahi.

Amazon / Myntra: unki ship API, tracking id usi `shipments` row par. `courier` = `amazon` ya `myntra`.

Vendor: out-of-stock / virtual line split. Accept ya reject. Reject par reason, us slice ka release, line wapas assign ke liye. Bulk tracking sirf assigned lines (`vendorScope`).

**Exit test**

- Ek Shopify order → ek AWB → Shopify fulfilled.
- Label cancel → Shopify unfulfilled, AWB cancelled.
- Ek Amazon order → marketplace tracking id, Delhivery call nahi.

---

## Phase 6 — Tracking, NDR, RTO, returns

**Pehle yeh ready ho**

| Cheez | Detail |
|---|---|
| Design | `/ndr`, `/rto`, `/returns`. Received par restock popup. |
| Backend | Phase 5 ka real AWB. Phase 4 push, restock ke baad. |
| Credentials | Delhivery tracking webhook ya poll token. Amazon/Myntra status + returns API. Shopify `read_fulfillments` ke saath returns scope jo app dikhaye. |

**Banana hai**

- Tracking `trackingEvents` par append. Status: picked up → in transit → out for delivery → delivered.
- NDR: reason, attempt, phone/address fix, reattempt ya RTO. Naya order nahi.
- RTO: receipt, QC, ledger `rto_restock`, phir Phase 4 push.
- Customer return pull. Approve → return label. Received → restock All / Shopify / Amazon / Myntra / None. Push sirf chune hue channels par.

**Exit test**

- Delivered order wahi Master Order rahe.
- NDR se naya order na bane.
- Return receive + restock se WH-001 aur channel ATS badhe.

---

## Phase 7 — GST + settlement

**Pehle yeh ready ho**

| Cheez | Detail |
|---|---|
| Design | `/gst-invoice`, `/payment-reconciliation`, `/returns-refunds-reconciliation`. |
| Backend | Phase 3 orders. Phase 6 returns usi order se jude. |
| Data | Warehouse state (CGST/SGST vs IGST). Company GSTIN. |

**Credentials / files (live API kam hai)**

| Data | Kaise |
|---|---|
| Amazon settlement | Report download ya file upload. Amazon app par Reports role. |
| Myntra payment file | File upload |
| Delhivery freight bill | File upload |
| Tally / Busy | OMS file export kare. Tally API is phase mein nahi. |

**Banana hai**

- Shopify invoice number = channel order id.
- CGST/SGST ya IGST: warehouse state vs ship-to state.
- Return par credit note.
- Expected net = gross − commission − shipping − fees − TCS/TDS − refunds. Match ya exception.
- Shopify COD “partially paid” jab tak payment mark na ho. Fulfilled ko Paid mat samjho.
- Courier bill alag: AWB weight, COD, RTO, NDR, surcharge. Marketplace settlement mein mat milao.

**Exit test**

- Delivered COD Shopify order paid na dikhe.
- Ek Amazon settlement line ek Master Order se match ho.
- Courier bill par zyada weight exception bane, silent match nahi.

---

## Phase 8 — Telegram

**Pehle yeh ready ho**

| Cheez | Detail |
|---|---|
| Design | `/notifications` event on/off. |
| Backend | Phase 5 vendor assign. |
| Credentials | Bot token (@BotFather). Vendor group chat id. Bot us group mein ho. |
| Email | Gmail app password pehle se password reset par hai. Wahi ops mail ke liye. |

**Banana hai**

- Vendor assign par ek Telegram message: order id, SKU, qty, ship-by.
- `/notifications` par jo email event on ho, wahi jaye.
- WhatsApp baad mein. Go-live WhatsApp par mat atkao.

**Exit test**

- Ek assign, ek message. Retry par doosra message nahi (send id notification row par).

---

## Go-live (Phase 8 ke baad)

Leheriya tenant, replica set, `/channels` par real keys.

| # | Test |
|---|---|
| 1 | Stock 1, do orders, ek reserve, ek out of stock |
| 2 | Duplicate webhook, ek Master Order |
| 3 | Shopify edit, wahi order, reservation adjust |
| 4 | Vendor reject, reason, line reassign |
| 5 | Label cancel, Shopify unfulfilled |
| 6 | Return received, QC, restock, ATS push |
| 7 | Tenant A, Tenant B ka data nahi dekh sakta |
| 8 | Channel down, job fail, retry, doosri reserve nahi |

**Is 100% mein nahi:** Flipkart, Meesho, AJIO, Nykaa, WhatsApp, asli 2FA app, Delhivery ke baad extra couriers, platform billing, Socket.IO dashboard.

**Hafte**

| Week | Phase |
|---|---|
| 1 | Phase 1 |
| 2 | Phase 2 |
| 3 | Phase 3 Shopify + teen tests |
| 4 | Phase 3 Amazon + Myntra |
| 5 | Phase 4 |
| 6 | Phase 5 Delhivery + Shopify fulfill |
| 7 | Phase 5 Amazon/Myntra ship + vendor |
| 8 | Phase 6 |
| 9 | Phase 7 |
| 10 | Phase 8 + go-live tests |
