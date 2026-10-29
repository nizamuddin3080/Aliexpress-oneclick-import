# Project Plan — AliExpress to Shopify One-Click Importer

## 1. Project Purpose

Build a lightweight Chrome Extension that imports a single AliExpress product into a connected Shopify store as a **Draft** with one click, utilizing a secure, minimal server-side companion for authentication, rate-limiting, and concurrency-safe duplicate prevention.

## 2. Problem Statement

Shopify store owners who source products from AliExpress must manually copy product titles, descriptions, images, variants, and prices — a tedious, error-prone process. Existing commercial tools often require expensive monthly subscriptions, demand broad multi-store access permissions, or introduce bloated dashboards and inventory sync engines when all the merchant needs is a simple, reliable one-click draft import.

## 3. Goals and Measurable Success Criteria

| Goal | Measurable Criterion |
|------|---------------------|
| One-click product draft import | User clicks once ("Import to Shopify") after reviewing preview; product is created in Shopify as Draft |
| Accurate data extraction | Product title, sanitized description, images, options, variant prices, and display currency extracted from AliExpress |
| Currency alignment & pricing | Source currency is verified against store currency; decimal-safe markup calculation (`Source Cost × (1 + Markup% / 100)`) with half-up rounding |
| Strict variant integrity | All variant option combinations mapped accurately; products exceeding Shopify's 3-option limit are explicitly rejected before mutation (never silently truncated) |
| Image handling transparency | Direct image pass-through with staged upload fallback; popup explicitly communicates whether all, some, or zero images imported |
| Concurrency-safe duplicate prevention | Import reservation pattern ensures at most one Shopify product is created for a given source product, even under concurrent clicks or ambiguous network timeouts |
| Secure credential boundaries | Shopify Admin access tokens and client secrets reside exclusively in backend encrypted storage (AES-256-GCM); extension receives only a short-lived, exchangeable auth token |
| Reliable error handling & no blind retries | Distinct states for validation errors, currency mismatch, duplicate detection, partial image success, and uncertain network outcomes (no blind retries on ambiguous mutations) |

## 4. Target User

A Shopify store owner who sources individual products from AliExpress and wants a fast, reliable, privacy-respecting workflow to create Shopify draft products for review and customization before publishing.

## 5. User Workflow

1. Install the unpacked Chrome Extension in Developer Mode.
2. Connect their Shopify store via a secure Authorization Code OAuth flow (offline access mode).
3. Backend fetches and caches store identity and store base currency (`shop { name, currencyCode }`).
4. User navigates to an AliExpress product detail page.
5. User clicks the extension icon in the Chrome toolbar.
6. Extension extracts product data including display currency.
7. Popup validates data and displays a compact preview: thumbnail, title, variant count, image count, source currency, source price, markup percentage input, and calculated selling price.
8. If AliExpress display currency does not match store currency, import is blocked with clear instructions to change AliExpress currency settings.
9. User adjusts markup percentage if desired and clicks **Import to Shopify**.
10. Backend reserves the import attempt in SQLite (`status: 'pending'`), executes the Shopify `productSet` mutation, and updates status upon response.
11. Extension displays the final result:
    - **Full Success:** Link to created Draft product in Shopify Admin.
    - **Partial Image Success:** Draft product link accompanied by a warning indicating how many images failed.
    - **Duplicate / In-Progress:** Direct link to existing product or progress notification.
    - **Ambiguous Outcome:** Direct link to Shopify Admin products list with instruction to verify before retrying (no blind retry).

## 6. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Extract product title (max 255 chars) from AliExpress product page |
| FR-02 | Extract product description HTML (max 50,000 chars) and sanitize client-side and server-side |
| FR-03 | Extract product image URLs (HTTPS only, allowlisted CDN hosts) |
| FR-04 | Extract product options (up to 3) and variant combinations |
| FR-05 | Extract variant-specific prices and display currency (ISO 4217 code) |
| FR-06 | Extract source product ID and full HTTPS source URL |
| FR-07 | Display compact product preview in popup with explicit source & selling currencies |
| FR-08 | Accept configurable markup percentage (0% to 1000%, default 30%) |
| FR-09 | Perform decimal-safe markup pricing calculation with half-up commercial rounding |
| FR-10 | Reject products with more than 3 option dimensions with an explicit error (no silent truncation) |
| FR-11 | Validate that extracted source currency strictly matches Shopify store currency; block if mismatched |
| FR-12 | Create product in Shopify as `status: DRAFT` via Admin GraphQL API (`productSet` mutation) |
| FR-13 | Attach source tracking metadata (`custom.aliexpress_source_id`, `custom.aliexpress_source_url`) as metafields |
| FR-14 | Enforce pre-mutation import reservation in database to prevent concurrent duplicate imports |
| FR-15 | Track image upload outcomes (full success vs. partial image failure) and surface counts in UI |
| FR-16 | Implement ambiguous-outcome reconciliation before allowing retry on timed-out mutations |
| FR-17 | Authenticate extension with backend via short-lived auth code exchange for JWT (no credentials in extension) |
| FR-18 | Enforce single active store model; connecting a second store deactivates previous store |

## 7. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | Extension popup renders initial preview in under 2 seconds on supported pages |
| NFR-02 | Synchronous draft import completes in under 30 seconds for standard products |
| NFR-03 | Zero secrets in client-side extension code or extension storage |
| NFR-04 | TypeScript strict mode (`"strict": true`) across both extension and server codebases |
| NFR-05 | Strict input validation on all untrusted AliExpress data and API request bodies |
| NFR-06 | HTTPS enforced for all extension-to-backend traffic, source product URLs, and image URLs |
| NFR-07 | SSRF protection on server-side fetches (DNS resolution checks, private IP blocking, redirect revalidation) |
| NFR-08 | Absolute prohibition of automated publishing (`status: ACTIVE` is strictly prohibited in code) |
| NFR-09 | Minimal Chrome extension permissions (`activeTab`, `scripting`, `storage`) |
| NFR-10 | Single-store isolation with clean token cleanup upon disconnect |

## 8. In-Scope Features

- Single-product manual import from supported AliExpress detail pages (`aliexpress.com`, `aliexpress.ru`)
- Pre-import validation and preview with explicit currency codes
- Configurable markup percentage
- Decimal-safe price calculation
- Product options and variant mapping (up to 3 options, up to 2,000 variants)
- Image import with direct pass-through and staged upload fallback
- Concurrency-safe duplicate prevention via import reservations
- Reconciliation for ambiguous network outcomes
- Draft-only product creation in Shopify
- Secure Dev Dashboard Custom App OAuth integration with offline access tokens

## 9. Out-of-Scope Features

- Bulk product importing
- Web-based merchant dashboard
- Automatic inventory or price synchronization
- Order fulfillment or dropshipping automation
- Multi-store simultaneous management
- Automatic currency conversion using fluctuating third-party exchange rates
- Product publishing (`ACTIVE` status)
- Bypassing CAPTCHAs, bot shields, or authenticated AliExpress sessions

## 10. Assumptions and Constraints

### Assumptions
- The merchant has administrative access to a Shopify store and can create a Custom App in the Dev Dashboard.
- The AliExpress product page contains extractable structured data (`window.runParams`, JSON-LD, or rendered DOM elements).
- The merchant sets their AliExpress display currency to match their Shopify store currency.
- The backend server runs locally or on the merchant's private hosting.

### Constraints
- AliExpress page DOM and script variables may change without notice; client extraction must use multi-strategy fallbacks.
- Shopify limits products to 3 options and 2,000 variants. Products exceeding 3 options must be rejected.
- Chrome Extension Manifest V3 service workers are ephemeral and cannot maintain long-running in-memory state.
- Shopify Admin GraphQL rate limit bucket applies (50 points/sec cost-based throttling).

## 11. Supported Product Envelope

To guarantee reliability, avoid request-size rejections, and comply with Shopify constraints:

| Dimension | MVP Supported Limit | Enforcement Action |
|-----------|---------------------|--------------------|
| Title length | 1–255 characters | Rejected if empty or > 255 chars |
| Description HTML | Up to 50,000 characters | Truncated with warning if > 50,000 chars |
| Option types | Maximum 3 option dimensions | **Rejected** if > 3 options (no silent truncation) |
| Variants | 1 to 2,000 variants | Rejected if > 2,000 variants |
| Images | 1 to 50 images | Capped at 50 images; rejected if 0 valid images |
| Image file size | Max 10 MB per image | Skipped with warning if oversized |
| API Request JSON | Max 1 MB body | HTTP 413 Payload Too Large if exceeded |

## 12. Major Technical Risks and Mitigations

| Risk | Severity | Mitigation Strategy |
|------|----------|---------------------|
| AliExpress page structure changes | Critical | Modular multi-strategy extraction (scripts → JSON-LD → DOM) with clear diagnostic errors |
| Concurrent clicks cause duplicate products | High | SQLite `BEGIN IMMEDIATE` import reservation pattern with `UNIQUE` constraint |
| Network timeout leaves ambiguous product state | High | State marked `needs_reconciliation`; query Shopify by source ID before retry; no blind retries |
| Currency mismatch distorts prices | High | Extract source currency, fetch store currency, block import if currencies do not match |
| Shopify blocks direct AliExpress CDN image fetching | Medium | Test direct URLs in M6-05; fall back to server-side safe-fetch + `stagedUploadsCreate` |
| SSRF vulnerabilities during image fetch | Medium | DNS resolution checks, loopback/private IP blocking, redirect revalidation |
| Leaked bearer credentials via URL fragment | Medium | Short-lived single-use auth code (60s TTL) exchanged via POST for JWT |

## 13. Milestones

| Milestone | Description | MVP? |
|-----------|-------------|------|
| M0 | Repository inspection, remediation, and planning approval | Pre-MVP |
| M1 | Project scaffolding and development environment | MVP |
| M2 | Shopify authentication and secure token lifecycle | MVP |
| M3 | AliExpress product and currency extraction | MVP |
| M4 | Popup UI with explicit currency, states, and preview | MVP |
| M5 | Shopify product creation and reservation lifecycle | MVP |
| M6 | Variant mapping, envelope limits, and image handling | MVP |
| M7 | Decimal-safe pricing and duplicate reconciliation | MVP |
| M8 | Testing, security hardening, and error recovery | MVP |
| M9 | Documentation, operations, and deployment | MVP |

**Minimum Viable Product:** M1 through M8 complete.

## 14. Acceptance Criteria

1. Extension installs as an unpacked MV3 extension without errors.
2. User authenticates Shopify store via secure OAuth; store name and base currency are cached.
3. Extension extracts product title, description, images, options, variants, prices, and display currency from supported AliExpress pages.
4. If AliExpress currency differs from store currency, import is blocked with an explanatory error.
5. If product has > 3 options, import is rejected with an explicit error (no silent truncation).
6. Decimal-safe markup calculation applies correctly with commercial half-up rounding.
7. Import reservation pattern prevents duplicate creation during concurrent import attempts.
8. Shopify product is created strictly with `status: DRAFT`.
9. Image upload outcomes (full success vs partial image failure) are accurately tracked and surfaced.
10. Ambiguous timeouts do not offer blind retries; reconciliation verifies product existence in Shopify.
11. No Shopify access tokens, client secrets, or sensitive credentials exist in extension code or extension storage.
12. All server-side fetches enforce SSRF protection against private IPs, loopbacks, and redirects.
13. User manual setup can be completed in under 30 minutes following deployment instructions.

## 15. Compliance and Content Notice

The importer copies product titles, descriptions, and images from AliExpress. The merchant is solely responsible for ensuring they have appropriate legal rights, licensing, or supplier permission to use and display imported product data and media. The extension is a developer tool and does not confer any intellectual property licenses.
