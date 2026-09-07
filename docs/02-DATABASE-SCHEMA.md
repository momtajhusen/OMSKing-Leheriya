# Database Schema (MongoDB Collections) — OMSKing

**Multi-tenant rule — Every document in every collection (except `tenants` itself) MUST carry a `tenantId: ObjectId` field, indexed.** This is enforced at both the Mongoose plugin level AND the Express middleware level. No query ever reaches the DB without a `tenantId` filter.

Every collection also has:
- `_id: ObjectId` (default)
- `createdAt`, `updatedAt` (Mongoose `timestamps: true`)
- `createdBy`, `updatedBy` (userId, nullable for system actions)

### Indexing conventions (to be applied Phase-by-Phase)
- Compound index `{ tenantId: 1, _id: -1 }` as default for list queries
- Unique constraints scoped to tenant, e.g. `{ tenantId: 1, code: 1 } unique` (not `code` alone)

---

## 1. tenants (NO tenantId — this is the root)

| Field | Type | Notes |
|-------|------|-------|
| name | String, required | Merchant legal name, e.g. "Leheriya Creations" |
| slug | String, unique, required | URL-safe identifier, e.g. "leheriya" |
| legalEntity | Object | address, gstin, pan, cin, phone, email, logoUrl |
| status | Enum: `active` \| `suspended` \| `trial` | Default `active` for Leheriya |
| plan | String | Future SaaS — `enterprise`, `pro`, `free`; for now `enterprise` |
| planExpiresAt | Date | Nullable |
| settings | Object | taxRegime, currency (INR), locale, timeZone, channelWebhookSecrets |
| onboardedBy | ObjectId → users._id | Nullable (seeded for Leheriya) |

---

## 2. users

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required, indexed** |
| fullName | String, required | |
| email | String, required | Unique per tenant: `{ tenantId, email } unique` |
| phone | String | Optional, E.164 |
| passwordHash | String, required | bcryptjs |
| avatarUrl | String | |
| roleId | ObjectId → roles | Required |
| status | Enum: `active` \| `disabled` \| `invited` | Default `active` |
| lastLoginAt | Date | Nullable |
| refreshTokenVersion | Number, default 0 | Incremented on logout → all refresh tokens invalidated |
| assignedVendorIds | [ObjectId → vendors] | Only used when `role = vendor` — restricts which vendor records the user can see |

---

## 3. roles

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** (global default roles are cloned per tenant) |
| name | String, required | e.g. "Super Admin", "Vendor" |
| code | String, required, unique per tenant | Enums: `super_admin`, `admin`, `vendor` — extensible later |
| description | String | |
| permissions | [String] | Flat permission key array, e.g. `["orders.read","orders.create","inventory.write"]`. See RBAC doc. |
| isSystem | Boolean, default false | `true` for the 3 launch roles — non-deletable |

---

## 4. products (Catalog, marketplace-agnostic product shell)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| name | String, required | Display name |
| description | String, long | |
| brand | String | |
| category | String | Hierarchy: `Women > Lehenga > Bridal` (slash-separated or path field) |
| hsnCode | String | 4–8 digits for GST |
| gstRatePercent | Number | 0, 5, 12, 18, 28 |
| images | [String] | URLs — S3 in future |
| status | Enum: `active` \| `draft` \| `archived` | |
| tags | [String] | Searchable |

→ Variants live below in `master_skus` (one product → many master SKUs).

---

## 5. master_skus (Identity Layer — the heart of the system)

Every sellable variant = exactly 1 Master SKU. Orders, inventory, vendors, shipping ALL reference `masterSkuId`.

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| productId | ObjectId → products | Nullable (standalone SKUs allowed) |
| code | String, required | `{ tenantId, code } unique`. Example: `LH-BRIDAL-RED-M`. Human-readable, immutable after first use. |
| name | String, required | Variant name: "Bridal Lehenga Red — M" |
| variantAttributes | Map<String,String> | `{ size: "M", color: "Red", design: "Bridal" }` |
| barcode | String | Physical barcode / EAN |
| costPrice | Number | Purchase/variable cost (for reconciliation) |
| mrp | Number | Maximum Retail Price |
| sellingPrice | Number | Default selling price (can be overridden per channel in sku_mappings) |
| weightKg | Number | For shipping calc |
| dimensionsCm | Object: {l,w,h} | |
| hsnCode | String | Inherits product-level if empty |
| gstRatePercent | Number | Inherits product-level if empty |
| status | Enum: `active` \| `discontinued` | |

---

## 6. sku_mappings (Master SKU ↔ Marketplace SKUs)

One Master SKU → many channel-specific SKU identifiers.

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| masterSkuId | ObjectId → master_skus | **Required, indexed** |
| channel | Enum: `shopify` \| `amazon` \| `myntra` \| `custom` | **Required** |
| channelProductId | String | Shopify product ID, Amazon ASIN, etc. |
| channelVariantId | String | Shopify variant ID, Amazon SKU-field, Myntra variant ID |
| channelSkuCode | String | The "SKU" field visible in the marketplace |
| channelTitle | String | |
| channelSellingPrice | Number | Optional override |
| syncStatus | Enum: `synced` \| `pending` \| `error` \| `unmapped` | |
| lastSyncedAt | Date | |
| lastSyncError | String | |
| isActive | Boolean, default true | |

Indexes: `{ tenantId, channel, channelVariantId } unique` (prevents duplicate mappings). Reverse: `{ tenantId, masterSkuId, channel }` for "show all channel mappings for this SKU".

---

## 7. warehouses

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| code | String, required | `{ tenantId, code } unique`. E.g. `WH-001` (Physical Jaipur), `WH-002` (Virtual Shopify-only) |
| name | String | "Jaipur Godown 1", "Shopify Virtual Stock" |
| type | Enum: `physical` \| `virtual` | |
| isDefault | Boolean | One default per tenant for fallback allocation |
| address | Object | line1, line2, city, state, pincode, gstin |
| contactPerson | String | |
| contactPhone | String | |
| status | Enum: `active` \| `inactive` | |

---

## 8. inventory (Current "available + reserved" snapshot per SKU × warehouse)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| masterSkuId | ObjectId → master_skus | **Required** |
| warehouseId | ObjectId → warehouses | **Required** |
| physicalQty | Number, default 0 | Physically counted qty in WH |
| reservedQty | Number, default 0 | Locked for paid/processing orders |
| virtualQty | Number, default 0 | Only used for virtual WHs (Shopify "available to promise") |
| reorderPoint | Number | Low-stock alert threshold |
| safetyStock | Number | |
| lastCountedAt | Date | |
| lastCountedBy | ObjectId → users | |

**Unique:** `{ tenantId, masterSkuId, warehouseId } unique`.  
Computed: `availableQty = physicalQty + virtualQty - reservedQty` (projected in queries, not stored).

---

## 9. inventory_ledgers (Immutable append-only movement log)

Every stock movement = 1 ledger entry. Double-entry pattern: every +X in one row must correspond to a -X elsewhere (same `transactionId`), with balanced sum = 0 across rows sharing a `transactionId`.

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| masterSkuId | ObjectId → master_skus | **Required** |
| warehouseId | ObjectId → warehouses | **Required** |
| transactionId | String | Group key for double-entry (e.g. `TRX-20250907-ABC`) |
| movementType | Enum | `purchase_receipt`, `order_reserve`, `order_release`, `fulfilment_deduct`, `fulfilment_revert`, `transfer_out`, `transfer_in`, `return_restock`, `rto_restock`, `adjustment_plus`, `adjustment_minus`, `physical_count`, `virtual_sync` |
| qtyDelta | Number (signed) | +10 or -3, etc. |
| balanceAfter | Number | Running per-SKU-per-WH balance (for audit) |
| referenceType | String | `order`, `purchase_order`, `return`, `rto`, `transfer`, `count` |
| referenceId | ObjectId → respective collection | |
| reason | String | Free text |
| performedBy | ObjectId → users | System = null |
| recordedAt | Date | Default now (can be back-dated for GRNs) |

**Never update or delete a ledger row.** New rows only.

---

## 10. orders (Master Orders — one row per channel order)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| orderNo | String, required | Internal human ID. `{ tenantId, orderNo } unique`. E.g. `OMS-ORD-2025-00001` |
| channel | Enum: `shopify` \| `amazon` \| `myntra` \| `manual` | **Required** |
| channelOrderId | String | Marketplace's own order ID. `{ tenantId, channel, channelOrderId } unique`. |
| channelOrderNo | String | Displayed to customer (Amazon has both ID + "Order #123-456") |
| status | Enum | Status-machine: `pending` → `processing` → `awaiting_fulfilment` → `shipped` → `delivered` → `completed` / `cancelled`. Separate states for RTO-in-progress and return-in-progress. |
| orderDate | Date | When placed on marketplace |
| paymentStatus | Enum: `pending` \| `paid` \| `cod` \| `refunded` \| `partially_refunded` | |
| paymentMethod | String | Razorpay, UPI, COD, Amazon Pay, etc. |
| customer | Object | name, email, phone (PII) |
| shippingAddress | Object | line1, line2, city, state, pincode, phone, countryCode=IN |
| billingAddress | Object | Same |
| gstCustomerType | Enum: `unregistered` \| `registered` \| `composition` | |
| gstin | String | Only if registered customer (B2B) |
| subtotalAmount | Number | Σ(items.sellingPrice × qty) |
| discountAmount | Number | Line-level + cart-level |
| taxAmount | Number | Σ GST |
| shippingCharge | Number | What customer paid for ship |
| otherCharges | Number | Gift wrap, cod surcharge, etc. |
| totalAmount | Number | Grand total paid by customer |
| currency | String, default "INR" | |
| fulfillmentType | Enum: `warehouse` \| `vendor` \| `split` | Auto-assigned by Phase 5 routing engine |
| assignedVendorId | ObjectId → vendors | Nullable (only for vendor-fulfilled) |
| assignedWarehouseId | ObjectId → warehouses | Nullable (only for WH-fulfilled) |
| shippingCourier | String | "Delhivery", "Bluedart", etc. — set at shipment creation |
| awb | String | Assigned in Shipment module |
| promisedDeliveryDate | Date | |
| actualDeliveryDate | Date | |
| cancellationReason | String | |
| cancelledAt | Date | |
| cancelledBy | ObjectId → users \| "system" \| "customer" | |
| sourceOrderData | Object | Raw JSON blob from marketplace webhook — for debugging |
| lastSyncedAt | Date | Last pull/push to channel |
| syncStatus | Enum: `synced` \| `pending_push` \| `pending_pull` \| `error` | |
| tags | [String] | |
| notes | String | Internal |

---

## 11. order_items (line items, 1 order → N items)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| orderId | ObjectId → orders | **Required, indexed** |
| lineNo | Number | 1, 2, 3… within order — stable display order |
| masterSkuId | ObjectId → master_skus | **Required** — unmapped items must be manually mapped before fulfilment |
| skuMappingId | ObjectId → sku_mappings | Exact (channel, variant) link |
| channelSku | String | Snapshot of the marketplace SKU at order time |
| titleSnapshot | String | Snapshot of product title (don't change when product is edited) |
| qtyOrdered | Number | |
| qtyShipped | Number, default 0 | |
| qtyCancelled | Number, default 0 | |
| qtyReturned | Number, default 0 | |
| unitSellingPrice | Number | Per-unit sell price |
| unitMrp | Number | |
| unitCostPrice | Number | For margin / COGS |
| discountAmount | Number | Line discount |
| gstRatePercent | Number | E.g. 12 |
| hsnCode | String | At order time |
| taxAmount | Number | Line total GST |
| lineTotal | Number | (qtyOrdered × sellingPrice) − discount + tax |
| status | Enum: mirrors order.status but per-line | Allows partial ship / partial cancel / partial return. |

---

## 12. vendors (Supplier / Dropship Vendor)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| code | String | `{ tenantId, code } unique`. V-001, V-002 |
| name | String, required | "Jaipur Textile Co." |
| contactPerson | String | |
| phone | String | |
| email | String | |
| address | Object | Same pattern as WHs |
| gstin | String | |
| pan | String | |
| bankDetails | Object | For reconciliation (future payout module): a/c, ifsc, beneficiary. Not used in Phase 9 yet. |
| telegramGroupId | String | For Phase 11 — vendor-specific Telegram routing |
| paymentTerms | String | "Net 15", "Advance 50%" |
| leadTimeDays | Number, default 3 | Auto-set on PO / vendor-assigned orders |
| rating | Number 1–5 | Manual/opinion, for internal use |
| status | Enum: `active` \| `inactive` \| `blacklisted` | |
| assignedUserId | ObjectId → users | The Vendor-role user who manages this vendor (1 vendor → 1 or many users) |

---

## 13. shipments (1 order can have 1..N shipments for split-ship)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| orderId | ObjectId → orders | **Required** |
| shipmentNo | String | `{ tenantId, shipmentNo } unique` |
| courier | String, required | |
| awb | String, required | `{ tenantId, awb } unique` per courier. Returned by courier API. |
| manifestNo | String | Batch/cluster identifier for end-of-day handover |
| orderItemIds | [ObjectId → order_items] | Which lines + qty are in this box (≥1) |
| warehouseId | ObjectId → warehouses | Only for WH-fulfilled |
| vendorId | ObjectId → vendors | Only for vendor-fulfilled |
| labelUrl | String | PDF label (S3 URL) |
| invoiceUrl | String | GST Invoice PDF (linked to invoices collection) |
| weightChargedKg | Number | Actual charged by courier |
| shippingCost | Number | What courier billed us |
| status | Enum: `created` \| `label_generated` \| `manifested` \| `picked_up` \| `in_transit` \| `out_for_delivery` \| `delivered` \| `cancelled` \| `rto_initiated` | Tightly synced to courier tracking API. |
| trackingEvents | [{timestamp, status, location, remarks}] | Append-only tracking history |
| isReturnShipment | Boolean, default false | `true` for reverse-pickup shipments created out of Returns module |
| labelCancelledAt | Date | If label cancelled → revert Shopify fulfilment status per Phase 7 rule |
| shippedAt | Date | When courier picked up |
| deliveredAt | Date | |

---

## 14. returns (Customer-initiated return / exchange)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| returnNo | String | Unique per tenant |
| orderId | ObjectId → orders | |
| orderItemId | ObjectId → order_items | Per-line return |
| qty | Number | |
| type | Enum: `refund` \| `exchange` \| `replacement` | |
| reason | String | "Size mismatch", "Defective", "Wrong item", etc. |
| customerRemarks | String | |
| internalNotes | String | |
| status | Enum | `requested` → `approved` → `label_generated` → `pickup_scheduled` → `picked_up` → `qc_pending` → `qc_passed` \| `qc_failed` → `refund_processed` \| `exchanged` \| `rejected`. |
| refundAmount | Number | Proposed + actual (after QC) |
| exchangeMasterSkuId | ObjectId → master_skus | If type=exchange |
| qcReport | Object | photos (URLs), passed items, failed items, remarks |
| restockWarehouseId | ObjectId → warehouses | Where QC-passed items go |
| restockedQty | Number | |
| restockLedgerId | ObjectId → inventory_ledgers | Pointer to the +qty row |
| requestedBy | ObjectId → users \| "customer" \| "system" | |
| requestedAt | Date | |
| closedAt | Date | |
| closedBy | ObjectId → users | |
| reverseShipmentId | ObjectId → shipments | Links to the reverse-leg AWB |

---

## 15. rto (Return To Origin — courier couldn't deliver)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| rtoNo | String | Unique |
| shipmentId | ObjectId → shipments | **Required** (RTO always starts from a forward shipment) |
| orderId | ObjectId → orders | Denormalized for fast queries |
| reason | String | "Customer refused", "Address unreachable", "No response", "Fake order" |
| courierStatus | String | Raw courier status before RTO flag |
| status | Enum: `rto_raised` → `in_transit_back` → `received_at_warehouse` → `qc_pending` → `qc_passed_restocked` \| `qc_failed_writeoff` → `closed` |
| qtyReturned | Number | |
| qcReport | Object | |
| restockWarehouseId | ObjectId | |
| restockedQty | Number | |
| restockLedgerId | ObjectId → inventory_ledgers | |
| writeoffQty | Number | Damaged / lost — no restock |
| writeoffReason | String | |
| courierChargedRtoFee | Number | |
| raisedAt | Date | |
| closedAt | Date | |

---

## 16. ndr (Non-Delivery Report — courier flagged, retry possible)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| ndrNo | String | Unique |
| shipmentId | ObjectId → shipments | **Required** |
| orderId | ObjectId → orders | Denormalized |
| reasonCode | String | Courier-specific code |
| reasonDescription | String | Human-readable |
| attempts | Number, default 1 | Courier delivery attempts so far |
| maxAttempts | Number, default 3 | After this → auto-elevated to RTO |
| nextReattemptDate | Date | |
| actionRequired | Enum: `none` \| `call_customer` \| `rebook_courier` \| `escalate_to_ops` \| `convert_to_rto` | |
| actionStatus | Enum: `pending` \| `in_progress` \| `resolved` \| `converted_rto` | |
| actionNotes | String | |
| status | Enum: `open` \| `resolved_delivered` \| `resolved_rto` \| `closed_other` | |
| escalatedAt | Date | Nullable, when attempts > threshold or manual escalation |
| closedAt | Date | |
| convertedRtoId | ObjectId → rto | FK if converted |

---

## 17. invoices (GST Invoices — Phase 9)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| invoiceNo | String | **Sequenced, tenant-unique, gapless.** Format: `INV/2025-26/00001`. Governed by a sequence counter. |
| invoiceDate | Date | Tax point date |
| orderId | ObjectId → orders | |
| shipmentId | ObjectId → shipments | Optional — B2B invoicing may pre-date shipment |
| type | Enum: `tax_invoice` \| `bill_of_supply` \| `refund_voucher` \| `debit_note` \| `credit_note` | |
| supplyType | Enum: `intra_state` \| `inter_state` | Decides CGST+SGST vs IGST split |
| placeOfSupply | String | State code (e.g. "29" for Karnataka) |
| reverseCharge | Boolean, default false | |
| seller | Object | name, gstin, address — from tenant.legalEntity snapshot |
| buyer | Object | name, gstin, address snapshot from order.billingAddress + order.gstin |
| lineItems | [Object] | Denormalized copy of order_items with HSN, qty, rate, taxable value, gst rate, cgst/sgst/igst amounts — immutable snapshot |
| totalTaxableValue | Number | |
| totalCgst | Number | |
| totalSgst | Number | |
| totalIgst | Number | |
| totalCess | Number, default 0 | |
| totalInvoiceValue | Number | In words also stored |
| amountInWords | String | |
| qrCodeUrl | String | E-invoice / IRN QR if applicable (later) |
| irn | String | e-Invoice Registration Number (future) |
| irnAckDate | Date | |
| status | Enum: `draft` \| `finalized` \| `sent` \| `cancelled` | Finalized = immutable |
| pdfUrl | String | S3/object storage |
| emailedAt | Date | |
| whatsappedAt | Date | Future |
| cancelledAt | Date | Cancellation must issue a credit note row, not delete |
| cancelledReason | String | |
| cancelledBy | ObjectId → users | |

---

## 18. payments (Captured from channel remittance files + manual)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| source | Enum: `amazon_settlement` \| `myntra_remittance` \| `shopify_payout` \| `bank_statement` \| `manual` | |
| sourceFileId | String | Filename or upload ref |
| transactionDate | Date | |
| transactionRef | String | UTR, settlement ID, payout ID |
| amount | Number | Net received (after deductions) |
| currency | String, default "INR" | |
| channel | Enum | same as orders.channel, plus `none` for bank credits |
| relatedOrderNos | [String] | Resolved/related — 1 settlement → N orders |
| deductions | [{label, amount, type}] | Marketplace commission, shipping fee, GST TDS, etc. (splittable per order later) |
| status | Enum: `uploaded` \| `reconciled` \| `partially_reconciled` \| `disputed` | |
| remarks | String | |
| reconciledBy | ObjectId → users | |
| reconciledAt | Date | |

---

## 19. reconciliations (Phase 9 — Payment + Returns reconciliation runs)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| runNo | String | Unique |
| type | Enum: `payment_reconciliation` \| `returns_refunds_reconciliation` | |
| periodStart | Date | Reconciliation window |
| periodEnd | Date | |
| source | Enum: same as payments.source | |
| status | Enum: `processing` \| `completed` \| `review_required` \| `finalized` | |
| totalRows | Number | |
| matchedRows | Number | |
| unmatchedRows | Number | |
| discrepancies | [{type, orderNo, expectedAmount, actualAmount, difference, reasonSuggestion}] | |
| summary | Object | totalExpected, totalReceived, totalShort, totalExcess, unreconciledCount |
| generatedBy | ObjectId → users | "system" for auto |
| generatedAt | Date | |
| finalizedAt | Date | |
| finalizedBy | ObjectId → users | |

---

## 20. notifications (Configurable per event — Phase 10)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| eventKey | String, required | E.g. `order.new`, `order.cancelled`, `vendor.assigned`, `shipment.delivered`, `stock.low`, `rto.raised` |
| enabledChannels | [{type: "telegram" \| "email" \| "whatsapp" \| "in_app", isEnabled: true, targets: [...]}] | Per-event, per-channel switchable on/off. Targets = userIds, roleIds, Telegram chatIds, emails. |
| templateOverrides | Object | For Phase 10: override default email/SMS/Telegram text |
| lastTriggeredAt | Date | |
| createdBy | ObjectId → users | "system" for defaults |

Seed rows per tenant for every event with default channels (telegram to super_admins for critical).

---

## 21. audit_logs (Everything material — Phase 11)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| actorId | ObjectId → users | Nullable for system actions |
| actorRole | String | Role snapshot at the time |
| action | String | `order.status_updated`, `inventory.adjusted`, `sku.created`, `user.role_changed`, etc. — dotted namespace convention |
| resourceType | String | Collection/entity: `orders`, `inventory`, `master_skus`, `users` |
| resourceId | ObjectId | The row being changed |
| resourceDisplay | String | E.g. "Order OMS-ORD-2025-00001" — human searchable |
| before | Object/Mixed | Snapshot before change (JSON). Can be null for CREATE. |
| after | Object/Mixed | Snapshot after change (JSON). Can be null for DELETE. |
| changes | [Object] | Diffs: [{ field, before, after }] for UI rendering |
| ip | String | HTTP request origin |
| userAgent | String | |
| metadata | Object | { route, method, requestId, ... } |
| createdAt | Date | Default now. **Indexed for time-range queries.** |

Append-only. Never update. TTL 3 years for non-financial; 7 years for tax/finance (invoices, reconciliations) as per law.

---

## 22. integration_jobs (Sync runs — Phase 10 + Phase 5 order sync)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| channel | Enum: `shopify` \| `amazon` \| `myntra` | **Required** |
| jobType | Enum: `orders_pull` \| `orders_status_push` \| `products_pull` \| `inventory_push` \| `shipment_push` \| `return_pull` \| `webhook_dispatch` \| `manual` | |
| direction | Enum: `pull` \| `push` | |
| status | Enum: `queued` \| `running` \| `success` \| `partial_success` \| `failed` \| `cancelled` | |
| startedAt | Date | |
| finishedAt | Date | |
| durationMs | Number | |
| recordsTotal | Number | |
| recordsProcessed | Number | |
| recordsFailed | Number | |
| failures | [{ref, error, stack, retried, lastRetryAt}] | Append |
| retriesCount | Number, default 0 | |
| triggeredBy | Enum: `scheduler` \| `manual` \| `webhook` | |
| triggeredByUserId | ObjectId → users | Nullable if manual |
| parentJobId | ObjectId → self | For fan-out sub-jobs |
| logsS3Url | String | For long logs, Phase 12 |
| shortSummary | String | Human-readable |

Webhook failures → create a new integration_job row per failed attempt so retry actions are auditable.

---

## 23. settings (Tenant-level keyed settings — Phase 10)

| Field | Type | Notes |
|-------|------|-------|
| **tenantId** | ObjectId → tenants | **Required** |
| group | Enum: `company` \| `channels` \| `couriers` \| `tax_gst` \| `api_credentials` \| `notifications` \| `ui` \| `features` | |
| key | String, required | `{ tenantId, group, key } unique`. E.g. (couriers, delhivery_api_key) |
| value | Mixed | Scalar or JSON |
| valueType | Enum: `string` \| `number` \| `boolean` \| `json` \| `secret` | `secret` values = encrypted at rest (Phase 10) |
| description | String | |
| updatedBy | ObjectId → users | |

Channel credentials (Shopify Admin API token, Amazon SP-API creds, Myntra Partner API creds) live here in group=channels, valueType=secret.

---

## Reference Summary — Entity Relations (for mental model)

```
tenants 1──N users
tenants 1──N roles
tenants 1──N products 1──N master_skus 1──N sku_mappings (× channels)
tenants 1──N warehouses
tenants 1──N inventory (master_sku × warehouse)
tenants 1──N inventory_ledgers (append-only, every stock move)
tenants 1──N orders 1──N order_items → master_skus / sku_mappings
tenants 1──N vendors (assigned to users via users.assignedVendorIds)
tenants 1──N shipments → orders (×1..N) / order_items / warehouse or vendor
tenants 1──N returns → orders / order_items / reverse shipment / inventory ledger
tenants 1──N rto → shipments
tenants 1──N ndr → shipments → may convert to rto
tenants 1──N invoices → orders / shipments (gapless numbered)
tenants 1──N payments → orders (M:N via relatedOrderNos)
tenants 1──N reconciliations → payments / orders
tenants 1──N notifications (per event + channel config)
tenants 1──N audit_logs (material change stream)
tenants 1──N integration_jobs (syncs per channel)
tenants 1──N settings (kv by group + key)
```
