# Tenant Onboarding & Project Setup Guide

This guide is the operational sequence for bringing a **new merchant tenant** onto OMSKing. Follow the phases in order. Each phase names what to configure, why it has to happen at that point, what breaks if it is skipped or reordered, and how to know the phase is finished.

OMSKing is a multi-tenant order system: one MongoDB database, one row per business fact, and a `tenantId` taken only from the signed-in user’s token. Shopify, Myntra, and Amazon are adapters in front of internal masters. They do not replace those masters.

| Internal master | What the channel contributes |
|---|---|
| Master SKU | Shopify variant, Amazon seller SKU + ASIN, Myntra catalog id |
| Logical warehouse (`WH-001`, `WH-002`) | Shopify location, Amazon inventory node, Myntra warehouse code |
| Master Order (one per channel order) | Channel order id, unique with tenant + channel |
| Inventory ledger | Never a single overwritten quantity |

Related references: `docs/03-MULTI-TENANCY.md`, `docs/08-DOMAIN-RULES.md`, `docs/09-MAIN-PAGES.md`, `docs/10-INTEGRATION-BUILD-PLAN.md`, `docs/04-RBAC-BLUEPRINT.md`, `apps/backend/.env.example`.

---

## How to read a phase

Every phase below uses the same four blocks:

1. **Configure** — the steps, in order.
2. **Why this stage** — the operational reason it cannot move earlier or later.
3. **If skipped or reordered** — the dependency you will hit.
4. **Gate** — the check that must pass before the next phase.

Do not paste marketplace tokens into git, logs, or chat. The API stores them encrypted and returns saved secrets as blank. Leaving a secret field blank on a later save keeps the value already stored.

---

## Prerequisites & environment rules

These settings belong to the **platform process**, not to one merchant. They are read from `apps/backend/.env` (copy from `apps/backend/.env.example`). Restart the API after changing them. A new tenant does not receive its own copy of this file.

### Database

| Requirement | Rule |
|---|---|
| One shared database | Every tenant lives in the same MongoDB database. Isolation is a `tenantId` on each row, not a database per company. |
| Replica set or Atlas | Stock reservation uses a transaction. A standalone `mongod` cannot lock the last unit atomically. |
| `MONGODB_URI` | Points at that replica set. |

Every business collection except `tenants` carries `tenantId`. Unique indexes are scoped to the tenant (`tenantId` + business key). A unique index on order number alone would collide across companies or, worse, hide one company’s order behind another’s.

The only source of `tenantId` on a user request is the JWT. Do not accept a tenant id from the URL, body, or query string. Webhooks resolve the tenant from the verified signature and secret, not from a tenant id in the path. Background jobs store `tenantId` on the job when they are queued and run under that tenant.

### Encryption

| Variable | Rule |
|---|---|
| `CHANNEL_ENCRYPTION_KEY` | Encrypts channel credentials and courier secrets at rest. |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Sign access tokens and refresh cookies. Replace both before any shared environment. |

Rotating `CHANNEL_ENCRYPTION_KEY` without re-encrypting existing rows makes saved tokens unreadable. Tokens are never returned to the browser and never written to logs.

### Queues

| Variable | Rule |
|---|---|
| `REDIS_URL` | Runs the worker. |
| `integration_jobs` | Still stores job type, channel, status, error, and retry count. |

Job types used during onboarding and daily running include `orders_pull`, `products_pull`, `inventory_push`, and `webhook_dispatch`. A retry must not reserve stock a second time or create a second Master Order.

### Webhooks and mail

| Variable | Rule |
|---|---|
| `PUBLIC_BASE_URL` | Public HTTPS origin with no trailing slash. Channel webhooks cannot be delivered to `localhost`. |
| `CORS_ORIGIN` | Browser origins allowed to call the API, comma-separated. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `MAIL_FROM` | Platform mailbox for invite mail and password-reset OTP. Use a Google App Password. Restart after changing them. |
| `MYNTRA_PULL_MINUTES` | Minutes between scheduled Myntra pulls. `0` disables the schedule. |

Optional `SHOPIFY_*`, `AMAZON_*`, and `MYNTRA_*` variables in `.env.example` are a **local seed for one existing company**. Leave them empty when onboarding a new tenant. That merchant saves keys in Settings, scoped to their token.

### Why this stage

Nothing in the product can isolate a company, encrypt a token, reserve a unit, or receive a webhook until the process has a replica set, an encryption key, a queue, and a public HTTPS origin.

### If skipped or reordered

| Missing piece | What you will see |
|---|---|
| Standalone MongoDB | Reservation cannot be atomic. Two orders can both take the last unit. |
| Wrong or empty encryption key | Saved channel secrets cannot be read. Tests and pulls fail closed. |
| No Redis | Pulls, pushes, and webhook work do not run, or they cannot retry safely. |
| No public HTTPS URL | Webhooks never arrive. Orders appear only if someone runs a manual pull, and missed events stay missed. |
| Tenant id taken from the client | One company can read or write another company’s orders and stock. |

### Gate

- The API starts against `MONGODB_URI` and the deployment is a replica set or Atlas.
- `CHANNEL_ENCRYPTION_KEY` and both JWT secrets are set and are not the example placeholders.
- Redis is reachable.
- `PUBLIC_BASE_URL` is HTTPS and is not localhost.
- CORS allows the admin origin the merchant will use.

---

## Phase 0: Tenant provisioning & isolated access

**Purpose:** create one company, its roles, its owner, and its two default warehouses as a single provisioning action. Packing, catalog, and channel keys do not exist yet.

### Configure

1. Platform Admin opens the subscriber flow and provisions the merchant with a company name, slug, owner name, owner email, and owner password.
2. Provisioning creates:
   - a `tenants` row with `kind: merchant`
   - a trial window when status is trial (length comes from platform settings)
   - a SKU prefix from the slug (first four letters, uppercased)
   - the owner’s email on the legal entity
3. The same action clones this tenant’s roles. Each role’s permissions are a copy for **this** `tenantId`. Authorization checks permission keys, not the role label.

| Role code | Name | Scope |
|---|---|---|
| `super_admin` | Merchant Super Admin | Full access inside this tenant only |
| `operations` | Operations | Orders, fulfilment, shipping, vendors |
| `warehouse` | Warehouse | Inventory, pick, pack, dispatch |
| `accounts` | Accounts | Payments and reconciliation |
| `catalog_manager` | Catalog Manager | Products, SKUs, mappings |
| `customer_support` | Customer Support | Orders, customers, returns |
| `vendor` | Vendor | Assigned lines and dispatch only |

Platform Admin is not a tenant role. That account sees subscribers and platform health. It does not pack this merchant’s orders unless it explicitly opens the tenant and then leaves again.

4. The owner user is created in status `active`, bound to `super_admin` and this `tenantId`.
5. Default warehouses `WH-001` and `WH-002` are created for this tenant only (Phase 2 fills their addresses; the rows must exist now).
6. Sign in as that owner. Every later screen in this guide is that session. Do not reuse another company’s login.

### Why this stage

Channels, stock, and orders are rows with `tenantId`. Without a tenant and a token that carries that id, there is nowhere to store a GSTIN, a location map, or a Master SKU. Roles have to exist before the owner invites operations, warehouse, catalog, or vendor users.

### If skipped or reordered

- Configuring Shopify or stock “in the database” before provisioning attaches data to no tenant, or to the wrong one.
- Sharing a super-admin login across companies breaks isolation. Tenant A must not see Tenant B.
- Creating channel keys before the owner exists means nobody in that company can rotate them.
- Skipping role clone leaves later invites with no permission set. Hiding a button in the UI is not the security check. The API still enforces the permission key.

### Gate

- The new owner signs in and lands on this company’s dashboard.
- Users & Roles lists the seven tenant roles above and no other company’s users.
- Warehouses shows `WH-001` and `WH-002` for this login only.
- A second merchant’s order list is not visible.

---

## Phase 1: Company profile & tax identity

**Purpose:** name the legal seller, decide who owns sellable quantity, and record where the company can be reached. Channel orders and invoices read this identity later. They do not create it.

### Configure

Settings → Company Details, as Merchant Super Admin:

| Field | Rule |
|---|---|
| Company name | Legal name printed on documents. |
| GSTIN | 15 characters. Stored in uppercase. |
| PAN | Stored in uppercase. |
| Support email and phone | Shown to operators. This phone is not automatically the warehouse pickup phone. |
| Address, city, district | Company profile. This address is **not** the courier pickup until you copy the real godown onto `WH-001` in Phase 2. |
| Company Gmail and app password | Optional. Only if this tenant sends its own OTP. A blank secret field does not erase a saved app password. |

Settings → Inventory source. Choose one. The product default when the field is unset is **OMS is master**.

| Authority | Who writes sellable qty | What the channels do |
|---|---|---|
| **OMS is master** | Staff stock in and stock out in Inventory. | Available qty is pushed to Shopify, Amazon, and Myntra. |
| **Shopify is master** | Shopify Location A. The OMS screen does not allow sellable edits. | Location A is read into `WH-001`, then Amazon and Myntra are updated. Shopify is not pushed. |

Settings → Tax, when you are ready for invoices: default GST rate (the schema default is 18%), category rates, and HSN rows. Tax configuration is not a substitute for opening stock.

### Why this stage

Inventory authority changes the meaning of every quantity you type in Phase 5. If you stock in under OMS-master and later switch to Shopify-master, the next sync overwrites `WH-001` from Location A and your typed qty is no longer the source. GSTIN has to exist before a tax invoice is issued for a dispatched order. The company address has to exist so Phase 2 can start from a known seller, but the pickup pincode is still a warehouse field.

### If skipped or reordered

- Connecting channels before choosing inventory authority lets the first stock push use the wrong source.
- Treating the company street as the pickup address leaves Shipping blocked later: label booking reads `WH-001` street, pincode, and phone, not the company profile.
- A missing GSTIN does not stop an order import. It stops a correct tax invoice.
- Saving inventory authority after mappings and opening stock forces a second stock policy on top of live reservations.

### Gate

- Company name, GSTIN, and support contact are saved.
- Warehouses (or Settings → Inventory source) states either “OMS is master” or “Shopify is master”, and that choice matches how you will load stock in Phase 5.
- You can name the godown address you will type in Phase 2. A profile with street and city but no postal code is not a finished pickup.

---

## Phase 2: Warehouse setup & location architecture

**Purpose:** give the tenant two logical warehouses and a pickup identity **before** any channel location id is trusted. Channel locations are attached to these warehouses. They do not define them.

### Why warehouses come before channel location mapping

A Shopify location id is an external key. `WH-001` and `WH-002` are the internal keys used by reservation, pack, vendor split, and available-to-sell. Provisioning inserts placeholder map rows (`shopify-location-a`, `shopify-location-b`, and similar placeholders for other channels) so the slots exist. The real location ids replace those placeholders only after the channel is connected and its locations are pulled (Phase 3). Mapping a live location before the two warehouses exist would attach stock to a code the pack desk does not have.

### Configure

1. Open Warehouses. Confirm the two rows for this tenant:

| Code | Name | Type | Sells on | Pickup |
|---|---|---|---|---|
| `WH-001` | Physical / Offline | Physical | Shopify, Amazon, and Myntra | Yes |
| `WH-002` | Virtual / Shopify only | Virtual | Shopify only | No |

Amazon and Myntra never read `WH-002`. Flipkart, Meesho, AJIO, and Nykaa, if those channels are enabled later, also read physical stock only.

2. On `WH-001`, open **Pickup address** and save:

| Field | Source |
|---|---|
| Street, city, state | The godown where the courier collects parcels. |
| Pincode | The godown’s postal code. Take it from the physical Shopify location’s address, or from the pickup location registered at the courier. It is not a channel id and it is not inside an API token. |
| Contact and phone | The person the courier calls. Company support phone is only a fallback if it is actually that person. |

3. Leave `WH-002` without pickup. Virtual stock is not a collection address.
4. Do not add extra warehouses unless the business truly has another physical node. Extra codes change which pool an order can reserve.

### Available-to-sell

Sellable quantity is **on hand minus reserved**, per warehouse, then summed by channel rule.

| Channel | Formula |
|---|---|
| Shopify | `WH-001` available + `WH-002` available, for SKUs stocked in each |
| Amazon | `WH-001` available only |
| Myntra | `WH-001` available only |

Worked rule, not a tenant’s live numbers: if physical on-hand is 4 and virtual on-hand is 1000, with nothing reserved, Shopify can sell 1004, and Amazon and Myntra can sell 4. After one unit is reserved on `WH-001`, Amazon and Myntra can sell 3, Shopify Location A shows 3, and Location B stays 1000.

One channel order is one Master Order even when Location A and Location B both fulfill it. The split is two fulfillment groups under that order, not two orders.

### Why this stage

Courier booking and the pack desk both assume `WH-001` is the physical pool and the pickup. Channel ATS in Phase 5 is defined only after this split exists. Doing pickup after the first orders arrive does not rewrite those orders onto the godown. It only unblocks the next label.

### If skipped or reordered

- Binding Shopify locations first leaves the map on placeholders or on the wrong warehouse, so virtual qty is offered to Amazon or Myntra, or physical qty never reaches Shopify Location A.
- Empty pincode, street, or phone on `WH-001`: Shipping reports the warehouse not ready. No Shopify AWB is booked. The Delhivery token can already be saved and this still fails.
- Marking `WH-002` as pickup, or turning on Amazon or Myntra for `WH-002`: marketplace ATS includes units the godown does not have.
- Typing stock before this phase writes a ledger against a warehouse whose channel flags are still wrong.

### Gate

- Both codes exist, types match the table, and `WH-001` is the only pickup.
- Pickup street, pincode, and phone are saved on `WH-001`.
- The location map may still show placeholders. That is expected until Phase 3 replaces them. Do not treat a placeholder id as the live Shopify location.

---

## Phase 3: Sales channel connections & integrations

**Purpose:** store this tenant’s channel credentials, prove each connection, and replace warehouse placeholders with that channel’s real location ids. Catalog import in Phase 4 reads these connections. It cannot run first.

### Why channels come before SKU mapping

A Master SKU is created from a channel listing. The listing is fetched with this tenant’s token. Without a connected channel there is no variant id, barcode, or seller SKU to map. Creating Master SKUs by hand first is allowed for a code you already know, but the live map (channel SKU ↔ Master SKU) still comes from the pull. Pull order is fixed: **Shopify, then Myntra, then Amazon.** The first channel creates the Master SKU. Later channels attach when barcode or seller SKU matches.

### Token security

- Save keys in Settings → Channel Connections and Settings → Courier Settings.
- The server encrypts them with `CHANNEL_ENCRYPTION_KEY`.
- The UI shows a saved secret as empty and says to leave it blank to keep it.
- Do not commit tokens, put them in `.env` for a new tenant, or copy another company’s app credentials into this tenant.
- Live calls run only when that connection’s API environment is `live` or, where the adapter allows it, `sandbox`. An empty environment does not mean “try production.”

Connect in this order. Finish the gate for one channel before starting the next.

### 3.1 Shopify

**Configure**

| Field | What to enter |
|---|---|
| API environment | `Live` for the merchant’s real shop. |
| Shop URL | The `*.myshopify.com` host. The public website host is not the API host. |
| Client ID and API secret | From that shop’s app. OMS requests the Admin token. A legacy custom app may paste an Admin token once. |
| Webhook secret | Used to verify callbacks and to find this tenant. |
| COD method names | Comma-separated gateway names that mean cash on delivery. Partially paid stays COD until money is recorded. |
| Import orders from | The date from which missed orders should be pulled. |

Scopes required before that capability is turned on:

| Capability | Scopes |
|---|---|
| Catalog and locations (this phase) | `read_products`, `read_inventory` |
| Orders (Phase 6) | `read_orders`, `write_orders` |
| Stock push (Phase 5, OMS is master) | `write_inventory` |

**Why now:** Shopify is the first catalog. Its two locations are the only ones that map onto both warehouses.

**If skipped:** Myntra and Amazon can still create Master SKUs, but the documented import order is then violated: a later Shopify pull can create a second identity for the same garment instead of attaching to the first.

**Gate**

- The Shopify tab shows Connected, and the test message matches the environment you selected.
- Warehouses → Channel location map shows two Shopify rows with the shop’s real location ids, not the placeholders `shopify-location-a` and `shopify-location-b`.
- The physical location (the offline shop) is on `WH-001` and is primary.
- The virtual location is on `WH-002` and is not primary.
- Location names on the map should match the names in Shopify admin. The ids are the binding. The names are the label.

### 3.2 Myntra PPMP

**Configure**

| Field | What to enter |
|---|---|
| API environment | `Live` only when Myntra has issued production credentials and you want pulls to run. |
| Merchant Id and Secret Key | From the PPMP / partner mail. The token request uses this pair. |
| API host | Leave blank to use `https://api-integration.myntra.com`. A host containing `pretr.com` is not used. The adapter replaces it with the integration host above. |
| Store Id and warehouse code | The partner warehouse code (the `C…W…` value). Inventory updates and order warehouse lines use this code. Store Id and warehouse code are the same value when Myntra issued only one. |
| Seller ID | Portal label from the seller card. Stored for operators. The token call does not use it. |
| Warehouse ID (portal) | The numeric id printed on that same seller card. Stored as a label. Do not type it into the warehouse-code field. |
| Import orders from | Start of the order pull. |

**Why now:** Myntra listings must attach to Master SKUs Shopify already created, by barcode or seller SKU.

**If skipped:** Shopify orders still flow. Myntra orders do not. If you connect Myntra before Shopify, Myntra becomes the catalog that mints Master SKUs and Shopify may duplicate them.

**Gate**

- Test reports that Merchant Id and Secret Key were accepted on the integration host.
- Warehouse code is the partner `C…W…` code.
- Seller ID and portal warehouse id are visible as labels and are different from the warehouse code.
- API environment is the one you intend. Empty environment does not pull.

### 3.3 Amazon

**Configure**

Use the app that belongs to **this** OMS and this seller. Do not reuse another product’s client id, client secret, or refresh token.

| Field | What to enter |
|---|---|
| API environment | `Sandbox` only with a sandbox refresh token. `Live` only with the production seller id, production refresh token, and LWA client id and secret. |
| Seller ID | Seller Central merchant token. Not the partner account id. |
| Refresh token | From authorizing this app in Seller Central. |
| LWA client id and secret | From the Developer Console app for this OMS. |
| Marketplace | India marketplace when you sell in India. Blank uses that default. |
| App id and partner account id | Labels for the operator. They do not replace the seller id. |
| Import orders from | Start of the order pull. |

**Why now:** Amazon is third so its listings match existing Master SKUs instead of creating a parallel catalog.

**If skipped:** Shopify and Myntra still operate. Amazon stays disconnected: no Amazon tab on orders, no Amazon series on the dashboard. Putting a sandbox refresh token into Live does not connect Live. The test stays failed and orders are not pulled.

**Gate**

- The Amazon tab is Connected in the environment you selected.
- Seller ID, refresh token, and LWA client id and secret are all present for that environment.
- The application id on the connection is this OMS app, not another company’s app.

### 3.4 Courier (Shopify self-ship)

Do this after `WH-001` has street, pincode, and phone. Amazon and Myntra do not use this courier.

**Configure** under Courier Settings → Manage Own Courier → Delhivery:

| Field | What to enter |
|---|---|
| API token | From the merchant’s Delhivery account. |
| Client name | The registered client name on that account. |
| API version | Only if the account states one. |
| Pickup warehouse name | The location **name** on the Delhivery account. Use `WH-001` only when Delhivery’s location is actually named that. |
| API environment | Leave unset until Phase 6 is ready to book. `live` is what allows the booking call. |

Add a second courier only after Delhivery labels work for this tenant. One courier at go-live.

**Why now:** the token is meaningless until the warehouse pickup exists, and it must not be switched to live before mapping and stock exist. A booked AWB on an unmapped or unreserved order cannot be reconciled.

**If skipped:** Shopify orders can still be reserved and packed. They cannot get an own-courier label. Booking with a warehouse name that does not exist on the Delhivery account fails at the courier, not in the OMS. Booking Amazon or Myntra orders on Delhivery violates the channel rule: those marketplaces keep their own tracking id.

**Gate**

- Delhivery shows saved and encrypted. The token field is blank in the form (that means it is stored).
- Pickup warehouse name matches the courier account.
- API environment is still empty unless you are intentionally ready to book.
- Shipping readiness names Delhivery and does not list a missing `WH-001` street, pincode, or phone.

### Phase 3 gate (all channels you will sell on)

- Shopify Connected, then Myntra Connected, then Amazon Connected, each on the intended environment.
- Location map placeholders for Shopify are gone.
- Integrations shows no stuck credential test.
- No secret is visible in the page, the audit row, or the job error text.

---

## Phase 4: SKU mapping & master catalog creation

**Purpose:** one internal Master SKU per sellable variant, with one mapping row per channel listing. Orders, stock, vendors, and shipments all point at the Master SKU. The channel SKU is only the listing’s identity.

### Configure

1. Pull or bulk-import catalog in this order: **Shopify → Myntra → Amazon** (`/import`, then `/sku-mapping`).
2. Shopify variants create Master SKUs (code, name, barcode when the listing has one).
3. Myntra, then Amazon, match an existing Master SKU by barcode or seller SKU and add a mapping row. They do not create a second Master SKU when the match hits.
4. On SKU Mapping, clear **Unmapped** and **Failed** for every variant you intend to sell:
   - Map the channel SKU to an existing Master SKU, or
   - Create a new Master SKU when the variant is truly new.
5. Retry a failed row after the Master SKU exists. Retry re-runs auto-map. It does not invent a second product.
6. Products hold the commercial shell (title, HSN, images). The Master SKU is the variant identity. Do not use the product id as the stock key.

### Unmapped handling

| Situation | System behavior |
|---|---|
| Barcode or seller SKU matches | One more mapping row on the existing Master SKU. |
| No match | Mapping stays Unmapped. No stock row is created for that listing. |
| Order arrives for an unmapped line | The line does not reserve. The order stays on hold until someone maps the SKU. Pack and vendor assign are refused for that line. |
| Same garment on three channels, matched | One Master SKU and three mapping rows. |

### Why this stage

Phase 3 proved the tokens and location ids. Phase 5 writes ledger rows by Master SKU id. A stock-in against a channel SKU that was never mapped has no warehouse balance for the order desk to reserve. Mapping after orders have already landed leaves those orders on hold until a person maps them. It does not backfill reservation by itself.

### If skipped or reordered

- Importing Amazon before Shopify creates Master SKUs from Amazon. The Shopify pull can then create duplicates for the same variant.
- Stocking a channel SKU that is Unmapped creates qty the order pipeline will not see, or no stock row at all, depending on the guard. Either way the order will not reserve.
- Packing before mapping fails closed: the line stays unfulfillable or on hold.
- Two Master SKUs for one variant split on-hand across identities. ATS on each channel is then wrong in opposite directions.

### Gate

- `/master-sku` has one code per sellable variant you will ship.
- A variant sold on all three connected channels has one Master SKU and one mapping per channel.
- SKU Mapping Unmapped and Failed are empty for those variants.
- A deliberately unknown SKU stays Unmapped and has no inventory row.

---

## Phase 5: Inventory initialization & ledger balance

**Purpose:** record opening quantity as an append-only ledger movement so reservation, ATS, and channel pushes share one history. This phase runs only after Master SKUs and warehouse flags exist.

### Why opening stock is a ledger movement

The domain rule is that inventory is a ledger, never a single overwritten quantity. Each movement stores tenant, Master SKU, warehouse, delta, the balance after the movement, type, reason, and who did it. Sellable qty is derived:

```text
on hand = physical qty + virtual qty
available = on hand − reserved
```

Available is never negative. A direct edit of “available” skips the movement, so a later reserve, restock, or audit cannot explain the number. Stock in on a physical warehouse writes a receipt movement (purchase receipt). Stock in on the virtual warehouse writes a virtual sync movement. Stock out writes an adjustment minus. An accepted order writes `order_reserve`. Cancel releases with `order_release`. Pack deducts with `fulfilment_deduct`.

Those types are the history. Overwriting the balance field would make two concurrent orders both succeed for the last unit, which the replica-set transaction is there to prevent.

### Configure

Do this only for Master SKUs that passed Phase 4. Do not create balances for Unmapped listings.

**When inventory authority is OMS is master**

1. Inventory → Stock in on `WH-001` for units the godown can ship.
2. Stock in on `WH-002` only for units that exist solely as Shopify virtual stock.
3. Each save appends a ledger row and queues `inventory_push` for channels that have a synced mapping:
   - Shopify Location A receives `WH-001` available.
   - Shopify Location B receives `WH-002` available.
   - Amazon receives `WH-001` only.
   - Myntra receives `WH-001` only, using the partner warehouse code from Phase 3, not the portal’s numeric warehouse id.
4. Set the reorder point after the opening balance exists. Low-stock alerts use that point. They are not the opening qty.

**When inventory authority is Shopify is master**

1. Do not type sellable qty. The Inventory screen does not offer that edit.
2. Run the inventory sync. It reads Location A into `WH-001`, writes that through the ledger path, then pushes Amazon and Myntra.
3. Shopify is not pushed in this mode. Location B remains Shopify’s own virtual qty (`WH-002`) and is not copied onto Amazon or Myntra.

### Channel ATS (same rule as Phase 2, now with numbers in the ledger)

| Pool | Shopify | Amazon | Myntra |
|---|---|---|---|
| `WH-001` available | Included (Location A) | Included | Included |
| `WH-002` available | Included (Location B) | Excluded | Excluded |
| Reserved on `WH-001` | Reduces Location A and Amazon and Myntra | Reduces Amazon | Reduces Myntra |
| Reserved on `WH-002` | Reduces Location B only | No effect | No effect |

### Why this stage

Pushing stock before mappings fans qty out to the wrong listing or to no listing. Pushing before warehouse flags fans virtual qty to Amazon and Myntra. Reserving before an opening ledger means every order is out of stock at `WH-001` and falls through to a vendor line even when the godown has goods.

### If skipped or reordered

- No opening ledger: Fulfilment pack count stays zero. Open orders become vendor lines (“out of stock at WH-001”) even though the channel storefront still shows stock.
- Direct qty edit, if someone bypasses stock in: the ledger and the balance disagree. The next reserve or push trusts the ledger path and the channel drifts.
- OMS-master stock in while you meant Shopify-master: OMS pushes that typed qty to Shopify and overwrites Location A.
- Shopify-master sync while Location A is wrong: `WH-001`, Amazon, and Myntra all inherit that mistake.
- Stock in before Phase 4: unmapped SKUs do not get a usable balance; mapped SKUs you have not pulled yet cannot be stocked.

### Gate

Pick one known Master SKU that is mapped on every connected channel.

- Inventory shows on hand, reserved, and available. Available equals on hand minus reserved.
- Movements lists the opening receipt. It is not a silent overwrite.
- Shopify ATS equals `WH-001` available plus `WH-002` available.
- Amazon ATS and Myntra ATS equal `WH-001` available only.
- With one unit reserved on `WH-001`, Amazon and Myntra drop by one and Shopify Location B does not.

---

## Phase 6: Operational verification & end-to-end order pipeline

**Purpose:** prove one channel order becomes one Master Order, reserves mapped stock, packs from `WH-001` or splits to a vendor, and ships on the correct courier. This is the first time order import and label booking should be turned on. Do not start here to “see data” if Phases 0–5 are open.

### Configure and run

1. Confirm Phase 3 import dates and scopes for orders (`read_orders` / orders access on each channel you sell).
2. Let the webhook or the scheduled pull import **one** order per connected channel. Do not hand-create a second order for the same channel order id.
3. Open Orders. Each channel order is one Master Order. A Shopify order that uses both locations is still one order with two fulfillment groups. Partially paid displays as COD until it is marked paid. A void payment is not booked as COD.
4. Open Fulfilment.
   - The oldest open order takes `WH-001` first.
   - Units that fit in `WH-001` are the pack list.
   - Units that do not fit, and Shopify virtual units, are vendor lines on the **same** Master Order.
   - An unmapped line stays on hold. Map it (Phase 4) before pack or assign.
5. If any line is a vendor line, create the vendor and a vendor login (role `vendor`) and assign only that vendor’s lines. The vendor accepts or rejects. Reject requires a reason and returns the slice for assignment. The vendor must not see another vendor’s lines.
6. Pack the `WH-001` slice from Fulfilment.
7. Ship:
   - **Shopify:** Shipping books the own-courier AWB from `WH-001` (serviceability, label, then manifest and pickup). Set the courier API environment to `live` only at this moment.
   - **Amazon and Myntra:** use that marketplace’s ship step. Do not book those orders on Delhivery. Their tracking id is stored on the same shipment row.
8. Cancel a test label only if you intend to: Shopify label cancel returns the marketplace fulfillment to unfulfilled and does not create a new Master Order. Reservation stays until the order itself is cancelled.
9. Integrations: a failed job may be retried. Retry must not reserve again and must not create a second Master Order.

### Why this stage

Earlier phases built identity (tenant), legal and stock policy (company), places (warehouses), pipes (channels), identities (Master SKUs), and quantities (ledger). The pipeline test is the only check that those pieces agree on one order. Running it earlier tests a stub and teaches the operator the wrong failure (empty pack, missing pincode, unmapped hold) as if it were a courier bug.

### If skipped or reordered

| You start here without… | What the order does |
|---|---|
| Phase 0 | The order is stored on the wrong tenant or cannot be stored. |
| Phase 1 authority | Stock push and the pack desk disagree about who owns qty. |
| Phase 2 pickup | Shopify label is refused. Readiness lists the missing street, pincode, or phone. |
| Phase 3 | No pull, or locations still on placeholders, so the line reserves the wrong warehouse. |
| Phase 4 | The line does not reserve. It sits on hold until mapped. |
| Phase 5 | The line is out of stock at `WH-001` and becomes a vendor line even when the godown has the goods. |
| Courier `live` too early | A real AWB and a real marketplace fulfill can be created for an order that is not mapped or not reserved. |
| Delhivery on an Amazon or Myntra order | The marketplace and the OMS disagree about the tracking id. |

### Gate

All of the following are true for this tenant:

| Check | Pass condition |
|---|---|
| Isolation | This login cannot open another tenant’s orders or settings. |
| One order | Importing the same channel order twice updates one Master Order. |
| Reserve | A mapped in-stock line has one `order_reserve` movement. Two orders for the last unit: one reserved, one out of stock. Available is not negative. |
| Unmapped | An unmapped line is on hold and has no reservation. |
| Pack | `WH-001` units appear on the pack list. Virtual and out-of-stock units appear as vendor lines on that same order. |
| Ship | Shopify label uses the own courier and `WH-001`. Amazon and Myntra keep their own courier. |
| Retry | A retried job does not reserve a second time and does not create a second order. |
| Dashboard | Counts match this tenant. Cancelled orders are not included in net sales. |

When every row passes, the tenant is onboarded. Daily work is then Orders → Fulfilment → Shipping, with returns, RTO, and GST after the first delivered order, not before this gate.

---

## Sequence at a glance

```text
Environment (replica set, encryption, Redis, public HTTPS)
        → Phase 0  Tenant, roles, owner, empty WH-001 and WH-002
        → Phase 1  GSTIN, contacts, inventory authority
        → Phase 2  Warehouse flags and WH-001 pickup
        → Phase 3  Shopify, then Myntra, then Amazon, then courier token
        → Phase 4  Master SKU and mappings (unmapped does not reserve)
        → Phase 5  Opening ledger, then channel ATS
        → Phase 6  One real order: reserve, pack or vendor, ship on the right courier
```

Stop at the first failed gate. Later phases do not repair an earlier one.
