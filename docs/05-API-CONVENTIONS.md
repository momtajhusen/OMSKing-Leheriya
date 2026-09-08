# API Convention — OMSKing

## 1. URL & Versioning

**Base URL:** `https://<host>/api/v1/`  
**Rule:** Every route lives under `/api/v1/`. No unversioned business routes.

If and when we need v2:
- Old routes keep `/api/v1/` running indefinitely
- New routes go under `/api/v2/`
- New major version = new folder `apps/backend/src/routes/v2/`

### Standard Naming
- Nouns, plural, kebab-case for multi-word:
  ```
  GET    /api/v1/orders
  GET    /api/v1/orders/:id
  POST   /api/v1/orders
  PATCH  /api/v1/orders/:id
  DELETE /api/v1/orders/:id
  GET    /api/v1/master-skus          (kebab-case, not master_skus nor MasterSkus)
  POST   /api/v1/shipments/:id/cancel-label
  ```
- Verbs in URL are allowed ONLY for non-CRUD actions (status transitions, bulk ops, actions):
  ```
  POST   /api/v1/orders/:id/approve
  POST   /api/v1/orders/:id/cancel
  POST   /api/v1/inventory/:id/adjust
  POST   /api/v1/shipments/bulk-generate-labels
  ```

---

## 2. HTTP Verbs

| Verb | Purpose | Idempotent | Safe |
|------|---------|:----------:|:----:|
| GET | Retrieve a resource / list | ✅ | ✅ |
| POST | Create a new resource / action endpoint | ❌ | ❌ |
| PUT | Replace a full resource | ✅ | ❌ |
| PATCH | Partial update (preferred over PUT for 95% of cases) | ❌ | ❌ |
| DELETE | Delete / archive a resource | ✅ | ❌ |

**Rule:** Prefer `PATCH` for updates, not `PUT`. PUT = full replacement; PATCH = only the fields you send change.

---

## 3. Standard Response Format

### Success — single object

```json
{
  "success": true,
  "message": "Order fetched successfully",
  "data": {
    "_id": "66d...",
    "orderNo": "OMS-ORD-2025-00001",
    "status": "processing",
    "..."
  }
}
```

### Success — list / paginated

```json
{
  "success": true,
  "message": "Orders list",
  "data": [
    { "_id": "66d...", "..." },
    { "_id": "66e...", "..." }
  ],
  "meta": {
    "page": 2,
    "limit": 50,
    "total": 1243,
    "totalPages": 25,
    "hasNext": true,
    "hasPrev": true
  }
}
```

### Success — action endpoint with no content

```json
{
  "success": true,
  "message": "Label cancelled. Shopify status reverted to Unfulfilled.",
  "data": null
}
```

Use `successResponse`, `paginatedResponse` utils from `apps/backend/src/utils/response.js`.

---

## 4. Error Response Format

### Generic error

```json
{
  "success": false,
  "message": "Order not found"
}
```

**Status: 404**

### Validation errors (form / request body)

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "path": "shippingAddress.pincode",
      "message": "Pincode must be exactly 6 digits",
      "value": "abc12"
    },
    {
      "path": "items.0.qty",
      "message": "Qty must be a positive integer",
      "value": 0
    }
  ]
}
```

**Status: 400**

### Authentication / Authorization

```json
{
  "success": false,
  "message": "Missing or invalid access token"
}
```

**Status: 401** (unauthenticated — token is bad/missing)

```json
{
  "success": false,
  "message": "Permission denied",
  "errors": [
    {
      "permission": "orders.delete",
      "role": "admin"
    }
  ]
}
```

**Status: 403** (authenticated, but forbidden to act)

---

## 5. Standard HTTP Status Codes

| Code | When to use |
|------|-------------|
| 200 OK | Default success for GET, PATCH, PUT, non-CRUD POSTs |
| 201 Created | POST creates a brand-new top-level resource (include `Location` header with canonical URL) |
| 204 No Content | DELETE that returns no body (rare — we usually return 200 with confirmation message) |
| 400 Bad Request | Validation failure, malformed body, bad params |
| 401 Unauthorized | No JWT, JWT expired, JWT tampered |
| 403 Forbidden | JWT is valid but user lacks permission / tenant is suspended |
| 404 Not Found | Resource does not exist OR exists but belongs to another tenant (return 404 in both cases to prevent ID enumeration) |
| 409 Conflict | Unique-index conflict, order state transition invalid, optimistic-lock version mismatch |
| 422 Unprocessable Entity | Semantically valid but business logic forbids it (e.g. "cannot cancel an order that is already delivered") |
| 429 Too Many Requests | Rate-limited — include `Retry-After` header |
| 500 Internal Server Error | Catch-all. Stack trace NEVER leaked to client (middleware strips). |
| 502/503 | Proxy/gateway — infra layer, not app code. |

---

## 6. Pagination Convention

Every list endpoint accepts these as **query parameters**, never as body:

| Param | Default | Range | Notes |
|-------|---------|-------|-------|
| `page` | 1 | ≥ 1 | |
| `limit` | 50 | 1 – 500 | Hard-cap 500. If client needs more than 500 they paginate. |
| `sort` | `-createdAt` | any sortable field | `-` prefix = DESC. Multi: `sort=status,-createdAt` |
| `search` | | free text | Backend maps to text indexes / regex on name/title/code per route. |
| `filter[field]` | | per field | e.g. `filter[status]=processing&filter[channel]=shopify` — exact match. Ranges use `filter[orderDate][gte]=2025-01-01&filter[orderDate][lte]=2025-01-31`. |

### Example list call

```
GET /api/v1/orders?page=2&limit=25&sort=-orderDate&search=OMS-ORD-2025&filter[status]=processing&filter[channel]=shopify&filter[orderDate][gte]=2025-01-01
```

The backend router layer parses `filter[]`, `sort`, `page`, `limit` into a standard `{ query, options: { sort, limit, skip } }` object before passing to controller/service.

---

## 7. Request Body Convention

- Always JSON: `Content-Type: application/json`
- No form-encoded bodies except file upload routes (which use `multipart/form-data`)
- Use camelCase for JSON keys (matches JavaScript, matches Mongoose schemas) — NOT snake_case, NOT PascalCase

---

## 8. File Uploads

- `POST /api/v1/uploads` (for invoices, QC pics, product images, settlement files)
- `multipart/form-data` with field name `file`
- Returns: `{ success: true, data: { url, key, size, contentType } }`
- URLs are object-storage URLs (S3-compatible), not raw base64 blobs in the DB.

---

## 9. Idempotency for Financial Actions

For POST endpoints that move money / book stock / generate invoices (actions that must not be duplicated on a double-click):

Client sends a header `X-Idempotency-Key: <UUID>` on the first attempt.
- If server has never seen this key → execute + persist the response.
- If the same key comes again within 24 hours → replay the cached response without re-executing.
- 409 if a different request body is sent with the same key.

Channel webhooks: unique `{ tenantId, channel, externalEventId }` on `webhook_events`. Second delivery is stored as `duplicate` and must not create a second Master Order or reservation.

Affected endpoints (Phase 4+):
- POST `/api/v1/inventory/reserve`
- POST `/api/v1/invoices`
- POST `/api/v1/payments/:id/reconcile`
- POST `/api/v1/inventory/:id/adjust`
- POST `/api/v1/shipments/bulk-generate-labels`
- webhook ingest `/api/v1/webhooks/:channel`

---

## 10. Routing File Layout

```
apps/backend/src/routes/
├── v1/
│   ├── index.js            → mounts all below on /api/v1/
│   ├── auth.routes.js
│   ├── tenants.routes.js
│   ├── users.routes.js
│   ├── roles.routes.js
│   ├── products.routes.js
│   ├── master-skus.routes.js        (kebab-case file)
│   ├── sku-mappings.routes.js
│   ├── warehouses.routes.js
│   ├── inventory.routes.js
│   ├── inventory-ledgers.routes.js
│   ├── orders.routes.js
│   ├── vendors.routes.js
│   ├── shipments.routes.js
│   ├── returns.routes.js
│   ├── rto.routes.js
│   ├── ndr.routes.js
│   ├── invoices.routes.js
│   ├── payments.routes.js
│   ├── reconciliations.routes.js
│   ├── notifications.routes.js
│   ├── audit-logs.routes.js
│   ├── integrations.routes.js
│   └── settings.routes.js
```

A route file only:
1. Declares the endpoint with HTTP method and URL
2. Wires middleware in order (`auth, tenant, requirePermission, vendorScope, handler`)
3. Delegates **all logic** to a controller. No business logic in route files.

Controllers delegate to services (for complex flows). Models = DB access only.
