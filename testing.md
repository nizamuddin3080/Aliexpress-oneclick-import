# Testing Strategy — AliExpress to Shopify One-Click Importer

## 1. Testing Framework and Architecture

| Testing Level | Framework / Tools | Scope & Responsibilities |
|---------------|-------------------|--------------------------|
| Unit Tests | Vitest | Pure logic: decimal money arithmetic, regex extraction, schema validation, URL security checks, option mapping |
| Integration Tests | Vitest + Mock Service Worker (MSW) | SQLite transactions, reservation state machine, Shopify GraphQL client, OAuth flow |
| Security Tests | Vitest + Custom Fixtures | SSRF DNS & IP filters, redirect traversal, HTML sanitizer bypass, JWT expiration, HMAC validation |
| Manual E2E | Chrome Browser (Unpacked MV3) | Live AliExpress detail pages, popup UI transitions, Shopify Admin Draft verification |

---

## 2. Unit Test Specifications

### 2.1 Pricing and Decimal Currency Calculations

**File:** `server/src/__tests__/pricing.test.ts`

| Test ID | Test Scenario | Inputs | Expected Output |
|---------|---------------|--------|-----------------|
| PR-01 | Standard markup calculation | cost: `"10.00"`, markup: `30` | `"13.00"` |
| PR-02 | Zero markup | cost: `"10.00"`, markup: `0` | `"10.00"` |
| PR-03 | 100% markup | cost: `"15.50"`, markup: `100` | `"31.00"` |
| PR-04 | Fractional cent rounding (half-up) | cost: `"0.99"`, markup: `33` | `"1.32"` (0.99 × 1.33 = 1.3167 → 1.32) |
| PR-05 | Half-way rounding exact threshold | cost: `"10.05"`, markup: `5` | `"10.55"` (10.05 × 1.05 = 10.5525 → 10.55) |
| PR-06 | Smallest unit pricing | cost: `"0.01"`, markup: `100` | `"0.02"` |
| PR-07 | High markup bound | cost: `"5.00"`, markup: `1000` | `"55.00"` |
| PR-08 | Prevent binary float distortion | cost: `"0.1"`, cost2: `"0.2"` | Correct sum `"0.30"` (no `0.30000000000000004`) |
| PR-09 | Negative price rejection | cost: `"-5.00"`, markup: `20` | Throws `ValidationError` |
| PR-10 | Negative markup rejection | cost: `"10.00"`, markup: `-10` | Throws `ValidationError` |

---

### 2.2 Currency Validation & Alignment

**File:** `server/src/__tests__/currency.test.ts`

| Test ID | Scenario | Extracted Currency | Store Currency | Expected Outcome |
|---------|----------|--------------------|----------------|------------------|
| CR-01 | Matching currencies | `"USD"` | `"USD"` | Passes validation |
| CR-02 | Matching euro | `"EUR"` | `"EUR"` | Passes validation |
| CR-03 | Mismatched currencies | `"CNY"` | `"USD"` | Rejects with `CURRENCY_MISMATCH` |
| CR-04 | Mismatched currencies | `"GBP"` | `"EUR"` | Rejects with `CURRENCY_MISMATCH` |
| CR-05 | Unknown / Missing currency | `""` or `null` | `"USD"` | Rejects with `INVALID_CURRENCY` |
| CR-06 | Malformed ISO code | `"US_DOLLAR"` | `"USD"` | Rejects with `INVALID_CURRENCY` |

---

### 2.3 URL & Hostname Allowlist Security

**File:** `server/src/__tests__/url-validation.test.ts`

| Test ID | URL String | Type | Expected Result |
|---------|------------|------|-----------------|
| UV-01 | `https://www.aliexpress.com/item/1005006123456789.html` | Source | Valid |
| UV-02 | `https://aliexpress.ru/item/1005006123456789.html` | Source | Valid |
| UV-03 | `https://m.aliexpress.com/item/1005006123456789.html` | Source | Valid |
| UV-04 | `http://www.aliexpress.com/item/1005006123456789.html` | Source | **Rejected** (HTTP disallowed; HTTPS required) |
| UV-05 | `https://evil.com/item/1005006123456789.html` | Source | **Rejected** (Untrusted domain) |
| UV-06 | `https://aliexpress.com.fake.com/item/123.html` | Source | **Rejected** (Domain spoofing) |
| UV-07 | `https://ae01.alicdn.com/kf/S1234567.jpg` | Image | Valid |
| UV-08 | `https://img.alicdn.com/imgextra/i1/123.jpg` | Image | Valid |
| UV-09 | `http://ae01.alicdn.com/kf/S1234567.jpg` | Image | **Rejected** (Must be HTTPS) |
| UV-10 | `https://evil-cdn.com/image.jpg` | Image | **Rejected** (Unapproved image host) |
| UV-11 | `https://user:pass@ae01.alicdn.com/image.jpg` | Image | **Rejected** (Credentials in URL forbidden) |

---

### 2.4 SSRF & Safe Fetch Validation

**File:** `server/src/__tests__/safe-fetch.test.ts`

| Test ID | Target URL / Scenario | Simulated DNS Resolution | Expected Result |
|---------|-----------------------|--------------------------|-----------------|
| SF-01 | `https://ae01.alicdn.com/image.jpg` | Public IP `198.51.100.1` | Allows fetch |
| SF-02 | `https://ae01.alicdn.com/image.jpg` | Resolves to Loopback `127.0.0.1` | **Blocked** (`SSRF_FORBIDDEN_IP`) |
| SF-03 | `https://ae01.alicdn.com/image.jpg` | Resolves to Private `10.0.0.5` | **Blocked** (`SSRF_FORBIDDEN_IP`) |
| SF-04 | `https://ae01.alicdn.com/image.jpg` | Resolves to AWS metadata `169.254.169.254` | **Blocked** (`SSRF_FORBIDDEN_IP`) |
| SF-05 | `https://ae01.alicdn.com/image.jpg` | Resolves to Private `192.168.1.1` | **Blocked** (`SSRF_FORBIDDEN_IP`) |
| SF-06 | Redirect to private IP | 302 → `https://127.0.0.1/admin` | **Blocked** (Redirect revalidation catches IP) |
| SF-07 | Redirect to disallowed domain | 302 → `https://evil.com/img.jpg` | **Blocked** (Hostname validation on target) |
| SF-08 | Oversized image payload | Content-Length: 15 MB | **Blocked** (`PAYLOAD_TOO_LARGE`) |
| SF-09 | Disallowed content type | Content-Type: `text/html` | **Blocked** (`INVALID_CONTENT_TYPE`) |

---

### 2.5 Variant & Option Mapping (Option Limits)

**File:** `server/src/__tests__/variant-mapping.test.ts`

| Test ID | Scenario | Input Options | Expected Result |
|---------|----------|---------------|-----------------|
| VM-01 | Single Option (Color) | `[Color: Red, Blue]` | Generates 1 option, 2 variants |
| VM-02 | Two Options (Color, Size) | `[Color: Red], [Size: S, M]` | Generates 2 options, 2 variants |
| VM-03 | Three Options (Max supported) | `[Color: Red], [Size: S], [Material: Cotton]` | Generates 3 options, 1 variant |
| VM-04 | **Four Options (Exceeds Limit)** | `[Color], [Size], [Material], [Plug]` | **Rejected** with `UNSUPPORTED_PRODUCT` (No silent dropping) |
| VM-05 | More than 2,000 variants | 2,050 variants generated | **Rejected** with `VARIANT_LIMIT_EXCEEDED` |
| VM-06 | Missing price on variant | Variant with `price: null` | **Rejected** with `INVALID_VARIANT_PRICE` |

---

### 2.6 HTML Description Sanitization

**File:** `server/src/__tests__/sanitizer.test.ts`

| Test ID | Input HTML Fragment | Expected Output |
|---------|---------------------|-----------------|
| SN-01 | `<p>Great headphones</p><script>alert(1)</script>` | `<p>Great headphones</p>` |
| SN-02 | `<img src="https://ae01.alicdn.com/img.jpg" onerror="steal()">` | `<img src="https://ae01.alicdn.com/img.jpg">` |
| SN-03 | `<a href="javascript:doEvil()">Click</a>` | `<a>Click</a>` (href removed) |
| SN-04 | `<iframe src="https://phishing.com"></iframe>` | Tag completely removed |
| SN-05 | `<p style="color: red;">Styled text</p>` | Clean paragraph tag without insecure CSS |

---

## 3. Integration Tests

### 3.1 Concurrency & Duplicate Prevention (Reservation Lifecycle)

**File:** `server/src/__tests__/reservation.test.ts`

| Test ID | Scenario | Steps | Expected Outcome |
|---------|----------|-------|------------------|
| RS-01 | Clean reservation and complete | 1. `reserveAttempt()`<br>2. Simulate Shopify success<br>3. `completeAttempt()` | Row created with `completed`, Shopify product ID persisted |
| RS-02 | **Race Condition: Simultaneous Imports** | Send 2 identical requests for source ID `1001` in parallel | 1st request succeeds; 2nd request immediately receives `409 IMPORT_IN_PROGRESS` |
| RS-03 | Re-import completed product | Attempt import for source ID `1001` when status is `completed` | Returns `409 DUPLICATE_PRODUCT` with Shopify Admin URL |
| RS-04 | Failed import retry | 1. Attempt fails (`userErrors`) → `status: 'failed'`<br>2. User clicks Try Again | Previous failed record deleted, new reservation succeeds |
| RS-05 | Stale pending cleanup | Reservation created 6 minutes ago without response | Treated as `needs_reconciliation` |

---

### 3.2 Ambiguous Outcome & Reconciliation

**File:** `server/src/__tests__/reconciliation.test.ts`

| Test ID | Scenario | Steps | Expected Outcome |
|---------|----------|-------|------------------|
| RC-01 | Mutation Timeout Handling | Shopify mutation times out after 30s | Attempt status set to `needs_reconciliation`, returns `502 UNKNOWN_OUTCOME` |
| RC-02 | Reconcile: Product Exists in Shopify | 1. Attempt is `needs_reconciliation`<br>2. Retry arrives<br>3. Shopify query finds product by metafield | Attempt updated to `completed`, returns `409 DUPLICATE_PRODUCT` with link |
| RC-03 | Reconcile: Product Does NOT Exist | 1. Attempt is `needs_reconciliation`<br>2. Retry arrives<br>3. Shopify query returns 0 matches | Stale attempt deleted, fresh reservation created, mutation executed |

---

### 3.3 Shopify GraphQL Client Integration

**File:** `server/src/__tests__/shopify-client.test.ts`

| Test ID | Scenario | Shopify Mock Response | Client Handling |
|---------|----------|-----------------------|-----------------|
| SC-01 | Successful product creation | `productSet` returns `id`, `status: "DRAFT"` | Returns product ID and admin link |
| SC-02 | Draft status verification | Payload inspected | Verifies input has `status: "DRAFT"` strictly |
| SC-03 | Partial image upload | 3 media IDs returned, 2 with errors | Returns outcome `completed_partial_images` |
| SC-04 | User validation error | `userErrors: [{ field: "title", message: "Too long" }]` | Returns HTTP 422 with readable field message |
| SC-05 | Cost-based throttling | `extensions.cost.throttleStatus` near threshold | Client delays subsequent request |
| SC-06 | Token revoked by merchant | HTTP 401 Unauthorized from Shopify | Returns `401 REAUTHORIZATION_REQUIRED` |

---

### 3.4 Authentication & Single-Store Lifecycle

**File:** `server/src/__tests__/auth-lifecycle.test.ts`

| Test ID | Scenario | Steps | Expected Result |
|---------|----------|-------|-----------------|
| AT-01 | OAuth HMAC validation | Tampered callback query parameters | Rejects with `400 INVALID_HMAC` |
| AT-02 | OAuth State Nonce verification | Replayed or invalid state parameter | Rejects with `400 INVALID_STATE` |
| AT-03 | Auth Code Exchange for JWT | Valid 32-byte code sent within 60s | Returns JWT with `storeDomain` |
| AT-04 | Replay of single-use auth code | Send same code twice | 2nd call rejected with `400 INVALID_CODE` |
| AT-05 | **Single-Store Replacement** | Connect Store B while Store A is active | Store A marked `is_active = 0`; Store B marked `is_active = 1` |
| AT-06 | Token encryption round-trip | Encrypt with AES-256-GCM and decrypt | Decrypted matches original token exactly |

---

## 4. Manual Chrome Extension E2E Test Suite

### 4.1 Prerequisites
1. Backend running locally on `http://localhost:3456`.
2. Chrome Extension unpacked from `extension/dist/`.
3. Test Shopify development store with Custom App installed.

### 4.2 Test Matrix

| ID | Test Case | Target Page | Steps | Expected Visual Outcome |
|----|-----------|-------------|-------|-------------------------|
| E2E-01 | Store Connection | Any page | Enter domain, complete OAuth | Popup shows "🟢 Connected: [Store] (USD)" |
| E2E-02 | Non-AliExpress Tab | `google.com` | Open popup | Shows "Navigate to AliExpress product page" |
| E2E-03 | Simple Product Import | AliExpress item (no variants) | Open popup, markup 30%, click Import | Shows Success; Shopify Admin shows Draft with 30% markup |
| E2E-04 | Multi-Variant Import | AliExpress item (Color + Size) | Open popup, click Import | Shows Success; Shopify shows all variants and option matrix |
| E2E-05 | 4-Option Product | AliExpress item (>3 options) | Open popup | Shows "⛔ Unsupported Product (>3 options)" with Import disabled |
| E2E-06 | Currency Mismatch | AliExpress item set to EUR | Open popup on store with USD | Shows "⚠️ Currency Mismatch: AliExpress EUR vs Store USD" |
| E2E-07 | Duplicate Import | Already imported item | Open popup | Shows "ℹ️ Already Imported" with Shopify Admin link |
| E2E-08 | Disconnect Store | Settings | Click Disconnect | Clears JWT; popup returns to Disconnected state |
