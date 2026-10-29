# API Specification — AliExpress to Shopify One-Click Importer

## 1. Overview

This document defines all communication interfaces:

- **Extension ↔ Backend:** Custom REST API (documented below).
- **Backend ↔ Shopify:** Shopify Admin GraphQL API (version verified at implementation start; planned: 2026-01).
- **Extension internal:** Chrome message passing (documented in architecture.md).

## 2. Backend Base URL

- **Development:** `http://localhost:3456` (exception: HTTPS not required for localhost only)
- **Production:** Configurable via `BACKEND_URL` environment variable. **Must use HTTPS.**

---

## 3. Authentication Endpoints

### 3.1 Initiate Shopify OAuth

```
GET /auth/shopify
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `shop` | string | Yes | Shopify store domain (e.g., `mystore.myshopify.com`) |

**Behavior:**
1. Validates `shop` domain format (must end in `.myshopify.com`).
2. Generates a cryptographically random state nonce and stores it in-memory with a 5-minute TTL.
3. Redirects to Shopify OAuth consent URL with `client_id`, `scope=write_products`, `redirect_uri`, `state`, and `access_mode=offline`.

**Response:** HTTP 302 redirect to Shopify OAuth consent screen.

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_SHOP_DOMAIN` | Shop domain is missing, empty, or doesn't match `*.myshopify.com` |

---

### 3.2 Shopify OAuth Callback

```
GET /auth/shopify/callback
```

**Query Parameters** (set by Shopify):

| Parameter | Type | Description |
|-----------|------|-------------|
| `code` | string | Authorization code |
| `shop` | string | Shop domain |
| `hmac` | string | HMAC signature for validation |
| `state` | string | CSRF nonce |
| `timestamp` | string | Request timestamp |

**Behavior:**
1. Validates the `state` nonce (must match stored nonce, single-use, not expired).
2. Validates the HMAC signature using the Shopify client secret.
3. Validates the `shop` domain format.
4. Exchanges the authorization code for an offline access token via `POST https://{shop}/admin/oauth/access_token`.
5. Queries `shop { name, currencyCode }` to get store metadata.
6. Encrypts the access token (AES-256-GCM) and stores it in SQLite. Deactivates any previously active store.
7. Generates a single-use auth code (32-byte random hex, 60-second TTL, stored in-memory).
8. Redirects to the extension's auth callback page.

**Success Response:** HTTP 302 redirect:
```
chrome-extension://<EXTENSION_ID>/src/popup/auth-callback.html?code=<auth_code>
```

The redirect target is constructed using the configured `EXTENSION_ID` environment variable. The backend never accepts an arbitrary redirect target from the request.

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_HMAC` | HMAC validation failed |
| 400 | `INVALID_STATE` | CSRF state mismatch, expired, or replayed |
| 400 | `INVALID_SHOP` | Shop domain format invalid |
| 502 | `TOKEN_EXCHANGE_FAILED` | Shopify rejected the authorization code |

---

### 3.3 Exchange Auth Code for JWT

```
POST /auth/exchange
```

**Request Body:**

```json
{
  "code": "<single-use-auth-code>"
}
```

**Behavior:**
1. Validates the code exists in the in-memory store, has not been used, and has not expired (60s TTL).
2. Deletes the code (single-use enforcement).
3. Issues a JWT with `{ storeDomain, storeId, iat, exp }` (7-day expiry).

**Response: 200 OK**

```json
{
  "token": "<jwt>",
  "store_name": "My Store",
  "store_currency": "USD",
  "shop_domain": "mystore.myshopify.com"
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_CODE` | Code is missing, invalid, expired, or already used |

---

## 4. Authenticated API Endpoints

All `/api/*` endpoints require a valid JWT in the `Authorization` header:

```
Authorization: Bearer <jwt>
```

**Common Authentication Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | `MISSING_TOKEN` | No Authorization header |
| 401 | `INVALID_TOKEN` | JWT signature verification failed |
| 401 | `TOKEN_EXPIRED` | JWT has expired; extension should prompt re-authentication |
| 401 | `STORE_NOT_FOUND` | Store in JWT is no longer active |
| 401 | `REAUTHORIZATION_REQUIRED` | Shopify token was revoked; user must reconnect |

---

### 4.1 Check Connection Status

```
GET /api/status
```

**Response: 200 OK**

```json
{
  "connected": true,
  "shop_domain": "mystore.myshopify.com",
  "store_name": "My Store",
  "store_currency": "USD"
}
```

---

### 4.2 Check Import Status

```
GET /api/import/:sourceProductId
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sourceProductId` | string | AliExpress product ID |

**Response: 200 OK — Not imported**

```json
{
  "status": "not_imported"
}
```

**Response: 200 OK — Already imported (completed)**

```json
{
  "status": "completed",
  "shopify_product_id": "gid://shopify/Product/1234567890",
  "shopify_admin_url": "https://admin.shopify.com/store/mystore/products/1234567890",
  "product_title": "Wireless Bluetooth Earbuds",
  "imported_at": "2026-10-29T10:30:00.000Z"
}
```

**Response: 200 OK — Import in progress**

```json
{
  "status": "pending",
  "message": "An import is already in progress for this product."
}
```

**Response: 200 OK — Needs reconciliation**

```json
{
  "status": "needs_reconciliation",
  "message": "A previous import attempt for this product had an uncertain outcome. The system will reconcile before proceeding.",
  "shopify_admin_url": "https://admin.shopify.com/store/mystore/products"
}
```

---

### 4.3 Import Product

```
POST /api/import
```

**Request Body:**

```json
{
  "source_product_id": "1005006123456789",
  "source_url": "https://www.aliexpress.com/item/1005006123456789.html",
  "source_currency": "USD",
  "title": "Wireless Bluetooth Earbuds TWS",
  "description_html": "<p>High quality wireless earbuds...</p>",
  "images": [
    {
      "url": "https://ae01.alicdn.com/kf/image1.jpg",
      "alt": "Product main image"
    },
    {
      "url": "https://ae01.alicdn.com/kf/image2.jpg",
      "alt": "Product side view"
    }
  ],
  "options": [
    {
      "name": "Color",
      "values": ["Black", "White", "Blue"]
    },
    {
      "name": "Type",
      "values": ["Standard", "Pro"]
    }
  ],
  "variants": [
    {
      "option_values": { "Color": "Black", "Type": "Standard" },
      "price": "12.99",
      "sku": "BT-BLK-STD"
    },
    {
      "option_values": { "Color": "Black", "Type": "Pro" },
      "price": "18.99",
      "sku": "BT-BLK-PRO"
    },
    {
      "option_values": { "Color": "White", "Type": "Standard" },
      "price": "12.99",
      "sku": "BT-WHT-STD"
    }
  ],
  "markup_percentage": 30
}
```

**Input Validation Rules:**

| Field | Validation |
|-------|-----------|
| `source_product_id` | Required. Non-empty string. Numeric characters only. |
| `source_url` | Required. HTTPS only. Hostname matches AliExpress allowlist. |
| `source_currency` | Required. Valid ISO 4217 currency code. Must match store currency. |
| `title` | Required. 1–255 characters. |
| `description_html` | Optional. Max 50,000 characters. Sanitized server-side (scripts, event handlers, tracking pixels removed). |
| `images` | Required. 1–50 items. Each `url` must be HTTPS, hostname matches alicdn.com allowlist, no credentials in URL. |
| `options` | Optional. **0–3 items only.** More than 3 is rejected (not truncated). Each `name` non-empty, each `values` non-empty array. |
| `variants` | Required if `options` present. 1–2,000 items. Each must have valid `option_values` matching declared options, and a positive `price` (as string, e.g., `"12.99"`). |
| `markup_percentage` | Required. Number ≥ 0 and ≤ 1000. |

**Response: 201 Created (Full Success)**

```json
{
  "success": true,
  "outcome": "completed",
  "import_attempt_id": 42,
  "shopify_product_id": "gid://shopify/Product/1234567890",
  "shopify_admin_url": "https://admin.shopify.com/store/mystore/products/1234567890",
  "title": "Wireless Bluetooth Earbuds TWS",
  "variants_created": 3,
  "images_requested": 2,
  "images_succeeded": 2,
  "images_failed": 0,
  "currency": "USD",
  "retryable": false
}
```

**Response: 201 Created (Partial Image Success)**

```json
{
  "success": true,
  "outcome": "completed_partial_images",
  "import_attempt_id": 42,
  "shopify_product_id": "gid://shopify/Product/1234567890",
  "shopify_admin_url": "https://admin.shopify.com/store/mystore/products/1234567890",
  "title": "Wireless Bluetooth Earbuds TWS",
  "variants_created": 3,
  "images_requested": 5,
  "images_succeeded": 3,
  "images_failed": 2,
  "currency": "USD",
  "retryable": false,
  "warnings": ["2 of 5 images could not be uploaded. You can add them manually in Shopify."]
}
```

**Error Responses:**

| Status | Code | Retryable | Description |
|--------|------|-----------|-------------|
| 400 | `VALIDATION_ERROR` | After fix | Request body failed validation (includes `fields` array) |
| 400 | `CURRENCY_MISMATCH` | After fix | Source currency doesn't match store currency |
| 400 | `UNSUPPORTED_PRODUCT` | No | Product exceeds supported limits (e.g., >3 options) |
| 409 | `DUPLICATE_PRODUCT` | No | Product already imported; includes `shopify_admin_url` |
| 409 | `IMPORT_IN_PROGRESS` | Wait | Another import for this product is currently running |
| 422 | `SHOPIFY_VALIDATION_ERROR` | Maybe | Shopify rejected the product data; includes Shopify `userErrors` |
| 429 | `RATE_LIMITED` | Yes (auto) | Shopify API rate limit hit; includes `retry_after_seconds` |
| 502 | `SHOPIFY_API_ERROR` | Yes | Shopify API returned a definitive error |
| 502 | `UNKNOWN_OUTCOME` | **No** | Shopify mutation sent but outcome uncertain; includes `shopify_admin_url` for manual check |
| 504 | `SHOPIFY_TIMEOUT` | **No** | Shopify API timed out; outcome uncertain; treated as `UNKNOWN_OUTCOME` |

**Error Response Format:**

```json
{
  "success": false,
  "outcome": "failed",
  "import_attempt_id": 43,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Product data validation failed",
    "fields": [
      { "field": "title", "message": "Title is required" },
      { "field": "images[0].url", "message": "URL must use HTTPS" }
    ],
    "retryable": true,
    "shopify_admin_url": null
  }
}
```

**Unknown Outcome Response:**

```json
{
  "success": false,
  "outcome": "needs_reconciliation",
  "import_attempt_id": 43,
  "error": {
    "code": "UNKNOWN_OUTCOME",
    "message": "The import request was sent but we could not confirm the result. Please check your Shopify Admin. Do not retry — the product may already exist.",
    "retryable": false,
    "shopify_admin_url": "https://admin.shopify.com/store/mystore/products"
  }
}
```

---

## 5. Idempotency and Concurrent Safety

The import endpoint uses an **import reservation pattern** (see database-schema.md and ADR-008):

1. **Reserve before execute:** Before calling Shopify, the backend inserts a `pending` record in `import_attempts` within a `BEGIN IMMEDIATE` SQLite transaction. This serializes concurrent writes for the same `(store_id, source_product_id)`.
2. **Concurrent request handling:** If request B arrives while request A is pending, request B receives `409 IMPORT_IN_PROGRESS`.
3. **Stale pending cleanup:** Pending records older than 5 minutes are treated as `needs_reconciliation`.
4. **No blind retry after timeout:** If the Shopify mutation's outcome is unknown, the backend records `needs_reconciliation`. Subsequent attempts for the same product trigger reconciliation (query Shopify by metafield) before creating a new reservation.
5. **Outcome-aware retry policy:** The API response includes `retryable: true/false`. `UNKNOWN_OUTCOME` is **never retryable** — the user must check Shopify Admin or wait for automatic reconciliation on the next attempt.

## 6. Rate Limit Handling

### Shopify API Rate Limits

- Shopify GraphQL Admin API uses a **cost-based throttle** (50 points/second, 1000 point bucket).
- The `productSet` mutation with variants and images typically costs 10–20 points.
- For single-product import, rate limits are unlikely to be hit.

### Handling:

1. Check `extensions.cost.throttleStatus` in every Shopify GraphQL response.
2. If `currentlyAvailable < requestedQueryCost`, wait before the next request.
3. If Shopify returns HTTP 429, extract `Retry-After` header and wait.
4. Return `429 RATE_LIMITED` to the extension with `retry_after_seconds`.
5. The extension displays "Rate limited — please wait X seconds" and may auto-retry after the wait period.

## 7. Timeout and Retry Rules

| Operation | Timeout | Server-Side Retries | Retry Conditions | Notes |
|-----------|---------|---------------------|-----------------|-------|
| Shopify OAuth token exchange | 10s | 0 | None | User retries OAuth manually |
| Shopify `productSet` mutation | 30s | 0 | **Never auto-retry** | Outcome may be ambiguous on timeout; mark `needs_reconciliation` |
| Shopify shop query | 10s | 1 | Transport error only (not 4xx) | |
| Shopify metafield reconciliation query | 10s | 1 | Transport error only | |
| Extension → Backend requests | 45s | 0 | None | Extension UI handles user-initiated retry |

**Critical:** `productSet` is never automatically retried by the backend. A timeout does not mean the mutation failed — it may have succeeded. The backend marks the attempt as `needs_reconciliation` and the extension shows an uncertain-outcome message.

**Error classification for retry decisions:**
- **Transport errors** (DNS failure, connection refused, TCP reset): The mutation was not delivered. Safe to allow a new attempt after cleaning up the `pending` record.
- **HTTP timeout** (request sent, no response): The mutation may or may not have been processed. Not safe to retry; mark `needs_reconciliation`.
- **GraphQL `userErrors`**: The mutation was processed and rejected. Safe to mark `failed` and allow retry after the user fixes the issue.

## 8. Shopify GraphQL Operations

### 8.1 Product Creation — `productSet`

Used by `POST /api/import` to create the product with variants, images, and metafields.

```graphql
mutation ProductImport($input: ProductSetInput!, $synchronous: Boolean!) {
  productSet(synchronous: $synchronous, input: $input) {
    product {
      id
      title
      handle
      status
      options {
        name
        optionValues {
          name
        }
      }
      variants(first: 250) {
        nodes {
          id
          title
          price
          sku
          selectedOptions {
            name
            value
          }
        }
      }
      media(first: 50) {
        nodes {
          id
          alt
          mediaContentType
          status
        }
      }
      metafields(first: 5) {
        nodes {
          namespace
          key
          value
        }
      }
    }
    userErrors {
      field
      message
      code
    }
  }
}
```

**Variables structure:**

```json
{
  "synchronous": true,
  "input": {
    "title": "...",
    "descriptionHtml": "...",
    "vendor": "AliExpress Import",
    "status": "DRAFT",
    "productOptions": [
      {
        "name": "Color",
        "values": [{ "name": "Black" }, { "name": "White" }]
      }
    ],
    "variants": [
      {
        "price": "16.87",
        "sku": "...",
        "optionValues": [
          { "optionName": "Color", "name": "Black" }
        ]
      }
    ],
    "files": [
      {
        "originalSource": "https://ae01.alicdn.com/kf/image1.jpg",
        "alt": "Product image",
        "mediaContentType": "IMAGE"
      }
    ],
    "metafields": [
      {
        "namespace": "custom",
        "key": "aliexpress_source_id",
        "value": "1005006123456789",
        "type": "single_line_text_field"
      },
      {
        "namespace": "custom",
        "key": "aliexpress_source_url",
        "value": "https://www.aliexpress.com/item/1005006123456789.html",
        "type": "url"
      }
    ]
  }
}
```

### 8.2 Shop Info Query

Used after OAuth to fetch store name and currency, and by `GET /api/status`.

```graphql
query {
  shop {
    name
    myshopifyDomain
    currencyCode
    plan {
      displayName
    }
  }
}
```

### 8.3 Reconciliation Query

Used to check if a product exists in Shopify when the import outcome is uncertain.

```graphql
query FindBySourceId($query: String!) {
  products(first: 1, query: $query) {
    nodes {
      id
      title
      status
      metafields(first: 5, namespace: "custom") {
        nodes {
          key
          value
        }
      }
    }
  }
}
```

Variables: `{ "query": "metafield:custom.aliexpress_source_id:1005006123456789" }`

### 8.4 Scopes Required

| Scope | Purpose |
|-------|---------|
| `write_products` | Create products, variants, product media, and metafields |

`write_products` implicitly includes `read_products`.

## 9. Operations Not Requiring a Custom Backend API

| Operation | Handled by |
|-----------|-----------|
| Product data extraction (including currency) | Content script (runs in browser, no API call) |
| Product preview display | Popup UI (uses extracted data directly) |
| Markup calculation and preview | Popup UI (pure computation, decimal-safe) |
| JWT storage | `chrome.storage.local` (extension-side) |
| Source URL format validation | Content script and backend (both validate) |

## 10. API Request Limits

| Limit | Value | Enforced by |
|-------|-------|-------------|
| Request body size | 1 MB | Express middleware |
| Requests per minute per store | 10 | Backend rate limiter |
| Concurrent imports per store | 1 | Import reservation pattern |
