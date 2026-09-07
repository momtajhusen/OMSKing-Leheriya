# Multi-Tenancy Strategy — OMSKing

## Strategy Locked: Shared Database + Row-Level Isolation via `tenantId`

Shared DB = one MongoDB deployment (or one Atlas cluster), one logical database (`omsking`), every collection shared by every tenant.

Why NOT separate DBs per tenant (database-per-tenant)?
- Overkill for 1 tenant + projected <20 tenants in Year 1
- Mongoose connection pool per DB = memory and complexity cost
- Cross-tenant admin reporting (future SaaS Ops dashboard) is harder
- Schema migrations require running on N databases

Why NOT separate collections per tenant (e.g. `leheriya_orders`)?
- Collection explosion, indexes multiplied, backup/restore is painful
- Mongoose models are per-collection — requires dynamic model registration

Row-level `tenantId`-filtering is the simplest, cheapest, most maintainable strategy for a SaaS-ready app starting at N=1.

---

## Rule 1 — Schema Level: `tenantId` on Everything

As defined in `02-DATABASE-SCHEMA.md`:

- **Every collection except `tenants`** has a required `tenantId: ObjectId` field
- Every query on a multi-tenant collection is filtered by `tenantId`
- Every insert/upsert auto-populates `tenantId` from the caller context
- Every unique index is **scoped to tenant**, e.g.
  ```
  { tenantId: 1, orderNo: 1 }     unique → good
  { orderNo: 1 }                  unique → BAD — allows collisions across tenants
  ```

---

## Rule 2 — Request Flow of `tenantId` (the Chain of Trust)

```
┌─────────────┐      JWT payload claims:       ┌──────────────────┐
│   Client    │ ── sub, role, tenantId ──────▶ │  Express Server  │
│ (Admin UI)  │   access_token (Authorization  │                  │
└─────────────┘   Bearer header)               │  1. auth        │
                                                │     middleware  │
       ▲                                        │     extracts    │
       │           401 → reissue via            │     claims      │
       │           /auth/refresh                │        │        │
       │           endpoint (refresh_token      │        ▼        │
       │           in HTTP-only cookie)         │  2. tenant      │
                                                │     middleware  │
                                                │     validates   │
                                                │     tenant      │
                                                │     exists +    │
                                                │     is active   │
                                                │        │        │
                                                │        ▼        │
                                                │  3. attach      │
                                                │     req.user +  │
                                                │     req.tenant  │
                                                │        │        │
                                                │        ▼        │
                                                │  4. controller  │
                                                │     → service   │
                                                │     → model     │
                                                │     ALWAYS      │
                                                │     filtered by │
                                                │     req.tenant  │
                                                │        │        │
                                                │        ▼        │
                                                │  5. Mongoose    │
                                                │     plugin      │
                                                │     auto-adds   │
                                                │     tenantId    │
                                                │     filter to   │
                                                │     EVERY       │
                                                │     query       │
                                                └──────────────────┘
```

### Critical: NEVER accept `tenantId` from the request body / query string / URL param.

The only source of `tenantId` is the decoded JWT access token (for normal user calls) OR a trusted internal service context (for background jobs). If an endpoint needs to operate "across tenants" (future SaaS super-admin panel), it uses a special `platform_admin` role flag that bypasses the filter — but for Leheriya launch, NO endpoint does that.

---

## Rule 3 — Mongoose Multi-Tenant Plugin (to be implemented in Phase 2)

A single global plugin registered BEFORE any model:

```
mongoose.plugin((schema) => {

  // 1. Ensure schema has the tenantId path
  if (!schema.paths._isTenantRoot && !schema.paths.tenantId) {
    schema.add({
      tenantId: { type: mongoose.Types.ObjectId, ref: 'tenants', index: true },
    });
    schema.paths._isTenantRoot = false;
  }

  // 2. Pre-find hooks — inject tenantId filter on EVERY find* / count / aggregate
  schema.pre(/^find/, function (next) {
    if (this.options._skipTenant === true) return next();   // escape hatch
    if (!this._tenantContext) return next(ERROR_MISSING_TENANT);
    this.where({ tenantId: this._tenantContext.tenantId });
    next();
  });

  // 3. Pre-save hooks — force tenantId into new docs & block cross-tenant updateOne
  schema.pre('save', function (next) {
    if (this.isNew) this.tenantId = this.$__.tenantContext?.tenantId;
    next();
  });

  schema.pre('updateOne', ... similar cross-tenant block ...);
  schema.pre('deleteOne', ...);
  schema.pre('deleteMany', ...);
  schema.pre('aggregate', inject $match tenantId stage as FIRST stage);
});
```

**Escape hatch:** `_skipTenant: true` option is only usable by `role = platform_admin` and requires a specific code review. Not used for Leheriya launch.

---

## Rule 4 — Background Jobs & Async Code

Every async job (BullMQ queue, cron, webhook, Shopify/Amazon sync):
1. Stores `tenantId` on the **job payload** when the job is enqueued
2. On worker execution, creates the same `{ _tenantContext: { tenantId } }` object and passes it through the same plugin pipeline

Shopify / Amazon / Myntra webhook endpoints:
1. Webhook hits `/api/v1/integrations/{channel}/webhook`
2. Signature verified FIRST using `settings` row for that (tenant, channel, webhook_secret)
3. After signature OK → look up the tenant from the signature match → set tenant context → process

**Never** identify tenant by URL param alone. The webhook secret itself maps to the tenant.

---

## Rule 5 — Tenant Onboarding (for future SaaS; Leheriya is seeded)

New merchant signs up → 1 atomic operation:
1. Insert new row into `tenants` → `tenant._id`
2. Clone the 3 default `roles` (super_admin, admin, vendor) with this `tenantId`
3. Clone the default 2 `warehouses` (WH-001 Physical + WH-002 Shopify Virtual)
4. Insert seed `notifications` rows (1 per event × default channels)
5. Insert seed `settings` defaults (tax=IN/GST 18%, currency=INR, etc.)
6. Invite the first super_admin user (tenant=the new merchant)

Everything above runs in a MongoDB session transaction so partial onboarding cannot happen.

---

## Rule 6 — Leaks We Guard Against (Checklist for PRs)

❌ Never do `Model.findOne({ orderNo })` without `tenantId` in the filter.
❌ Never accept `tenantId` in request body/query/params and use it directly.
❌ Never run a raw `mongoose.connection.db.collection(...)` bypassing Mongoose models — that skips the plugin.
❌ Never create a MongoDB index `unique: true` that is not also scoped to `tenantId`.
❌ Never broadcast `find({})` to every tenant by forgetting `where({ tenantId })`.
❌ Never return a `resourceId` in an API response and then accept it in another endpoint WITHOUT re-checking that it belongs to `req.tenant`.

If you're unsure, assume cross-tenant data leak is the default unless explicitly proven otherwise.

---

## Migration Path If Strategy Changes

If N of tenants crosses ~500 or data volume exceeds ~200 GB:
1. **Step 1:** Shard MongoDB by `{ tenantId: 1, _id: 1 }` (hashed shard key on `tenantId`) — zero code changes, just infra.
2. **Step 2 (very rare):** Migrate to database-per-tenant via routing layer. The `tenantId` column still works as migration glue between old and new DBs.
