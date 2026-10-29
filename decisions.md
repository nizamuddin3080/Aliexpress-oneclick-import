# Architectural Decision Records — AliExpress to Shopify One-Click Importer

## ADR-001: Chrome Extension Manifest V3

- **Status:** Accepted
- **Context:** Chrome extensions can use Manifest V2 or V3. Manifest V2 is deprecated and will be removed from Chrome.
- **Options:**
  1. Manifest V2 — broader API support but deprecated.
  2. Manifest V3 — current standard, uses service workers instead of background pages.
- **Decision:** Use Manifest V3.
- **Reasoning:** V2 is deprecated. V3 is required for new Chrome Web Store submissions and long-term support. Service workers are sufficient for our needs (message passing, no persistent background state required).
- **Consequences:** Must use `chrome.scripting` API instead of `chrome.tabs.executeScript`. Background service worker is ephemeral — no persistent in-memory state.

---

## ADR-002: Minimal Backend Required

- **Status:** Accepted
- **Context:** The extension needs to authenticate with Shopify, store access tokens securely, make Shopify API calls, and manage import attempts for concurrent safety and duplicate prevention. Chrome Extensions cannot securely store secrets — `chrome.storage` is readable by the user and other extensions with debugging access.
- **Options:**
  1. Extension-only (no backend) — store tokens in `chrome.storage.local`.
  2. Minimal Node.js backend — handle auth, token storage, Shopify API proxy, import state management.
  3. Serverless functions (AWS Lambda, Cloudflare Workers) — per-endpoint deployment.
  4. Full web application with frontend dashboard.
- **Decision:** Minimal Node.js/Express backend.
- **Reasoning:**
  - Shopify access tokens must not be in client-side code (security requirement).
  - Import attempt reservation and concurrent safety require server-side state.
  - Duplicate prevention requires persistent source→Shopify ID mapping.
  - A single Node.js server is the simplest option that satisfies all three requirements.
  - Serverless adds deployment complexity for marginal benefit in a single-store tool.
  - A full web app is out of scope.
- **Consequences:** Requires a running server (localhost for development, hosted for production). Adds deployment complexity compared to extension-only, but satisfies security and correctness requirements.

---

## ADR-003: SQLite for Persistence

- **Status:** Accepted
- **Context:** The backend needs to persist: (a) Shopify access tokens (encrypted), (b) import attempt records for reservation, completion, reconciliation, and duplicate prevention.
- **Options:**
  1. No database — store mappings in Shopify metafields only.
  2. JSON file on disk.
  3. SQLite.
  4. PostgreSQL.
  5. Redis.
- **Decision:** SQLite via `better-sqlite3` in WAL mode.
- **Reasoning:**
  - Only two small tables needed (`stores`, `import_attempts`).
  - SQLite is zero-configuration, file-based, and embeddable.
  - `better-sqlite3` provides synchronous API which simplifies transaction logic for the reservation pattern.
  - `BEGIN IMMEDIATE` transactions provide the write serialization needed for concurrent duplicate checks.
  - PostgreSQL is overkill for a single-store tool.
  - Redis doesn't provide durable persistence by default.
  - JSON files lack ACID guarantees and concurrent access safety.
  - Shopify metafields alone cannot store access tokens and cannot provide pre-mutation reservation.
- **Consequences:** Database file must be in `.gitignore`. Single-writer limitation is acceptable for single-store use. Backup is a single file copy. Migration to PostgreSQL is straightforward if ever needed.

---

## ADR-004: Shopify Authentication — Custom App with Offline Access Tokens

- **Status:** Accepted
- **Verified:** 2026-10-29. Shopify Dev Dashboard is the current method for creating custom apps. Legacy admin-panel custom app creation is deprecated for new apps.
- **Context:** The extension needs a Shopify access token to call the Admin GraphQL API. Shopify deprecated admin-created custom apps with static permanent tokens. New custom apps must be created via the Dev Dashboard.
- **Options:**
  1. Legacy admin-created custom app with static token — deprecated for new app creation.
  2. Custom App via Dev Dashboard with Authorization Code OAuth (offline access).
  3. Custom App via Dev Dashboard with Client Credentials grant.
- **Decision:** Custom App via Dev Dashboard with Authorization Code OAuth requesting **offline** access tokens.
- **Reasoning:**
  - Legacy static tokens are deprecated for new app creation.
  - Authorization Code OAuth with `access_mode=offline` issues a long-lived token that does not expire (Shopify's documented behavior for offline tokens).
  - No refresh token is needed — offline tokens remain valid until the app is uninstalled or credentials are rotated.
  - Client Credentials grant may issue tokens with expiration, requiring refresh logic.
  - OAuth provides a clear user-consent flow with explicit scope approval.
- **Token lifecycle:**
  - **Issuance:** After OAuth consent, Shopify returns an offline access token.
  - **Storage:** Encrypted at rest in SQLite (AES-256-GCM).
  - **Expiration:** Offline tokens do not expire.
  - **Revocation:** Occurs when the app is uninstalled or credentials are rotated. Detected when Shopify returns HTTP 401.
  - **Reauthorization:** On 401 from Shopify, the backend returns 401 to the extension with `reauthorization_required: true`. The popup prompts the user to reconnect.
- **Consequences:**
  - Backend implements OAuth initiation, callback validation (HMAC + state), and token exchange.
  - No refresh-token logic needed (simplifies implementation).
  - User must create app in Dev Dashboard, configure redirect URL, and install on their store.
  - `scopes_granted` is stored to detect if the app was reinstalled with different scopes.

---

## ADR-005: AliExpress Data Extraction Strategy

- **Status:** Accepted with documented risks
- **Context:** AliExpress product pages are JavaScript-rendered. There is no reliable public API. Data must be extracted from the rendered page.
- **Options:**
  1. Parse embedded `<script>` tags for `window.runParams` or SSR hydration data.
  2. Parse JSON-LD structured data (`application/ld+json`).
  3. DOM element extraction from rendered page.
  4. Intercept MTOP API network requests.
  5. Use third-party scraping APIs.
- **Decision:** Multi-strategy extraction with priority order:
  1. **Primary:** Parse `<script>` tags for embedded JSON data (`window.runParams`, SSR state).
  2. **Secondary:** JSON-LD structured data.
  3. **Tertiary:** DOM element extraction (title, images, price elements).
  4. **Fallback:** Clear error message when required data cannot be extracted.
- **Reasoning:**
  - Embedded script data provides the richest structured information (variants, prices, SKUs).
  - JSON-LD provides basic product info (title, image, base price) as a reliable fallback.
  - DOM extraction handles cases where neither structured source is available.
  - MTOP API interception is reverse-engineering a private API — violates our no-unsafe-scraping rule.
  - Third-party scraping APIs add cost, latency, and external dependencies.
- **Consequences:**
  - **CRITICAL RISK:** AliExpress page structure changes frequently. Extraction may break without notice.
  - Content script must use bridge script injection to access main-world JavaScript variables.
  - Multiple extraction strategies increase code complexity but improve resilience.
  - Extraction code will need maintenance when AliExpress updates their page structure.
  - **Extraction must also capture the displayed currency code** to enable currency validation (see ADR-011).

---

## ADR-006: Shopify Product Creation — `productSet` Mutation

- **Status:** Accepted
- **Verified:** 2026-10-29 against Shopify Admin GraphQL API documentation.
- **Context:** Shopify GraphQL Admin API offers multiple mutations for product creation: `productCreate` + `productVariantsBulkCreate` (multi-step), or `productSet` (single mutation).
- **Options:**
  1. `productCreate` followed by `productVariantsBulkCreate` — two-step process.
  2. `productSet` — single mutation that creates product, options, variants, and attaches media.
- **Decision:** Use `productSet` mutation with `synchronous: true`.
- **Reasoning:**
  - `productSet` handles product + options + variants + media in a single atomic operation.
  - Reduces partial failure risk compared to multi-step approach.
  - `synchronous: true` returns complete product data (including IDs) in the response.
  - Well-documented and supported in current API versions.
- **Consequences:** Single API call for product creation. Must structure the input payload correctly with `productOptions`, `variants`, and `files`. Synchronous mode may time out for products with very many variants/images — acceptable for single-product import within our defined product envelope limits.

---

## ADR-007: Draft Status Enforcement

- **Status:** Accepted
- **Context:** Products must never be automatically published. The user must review and publish manually.
- **Options:**
  1. Set `status: "DRAFT"` in the `productSet` mutation.
  2. Create as ACTIVE then immediately update to DRAFT.
  3. Rely on Shopify's default status.
- **Decision:** Explicitly set `status: "DRAFT"` in the `productSet` mutation input.
- **Reasoning:** Explicit is safer than relying on defaults. Setting it at creation time eliminates any window where the product could be visible. No second API call needed.
- **Consequences:** Products are never visible to store customers until the merchant manually publishes them.

---

## ADR-008: Duplicate Prevention — Import Reservation Pattern

- **Status:** Accepted
- **Context:** Users may accidentally click import twice, or two browser tabs may attempt import concurrently. Creating duplicate products wastes time and clutters the store.
- **Options:**
  1. Check by product title match in Shopify (unreliable).
  2. Check-then-create in the backend database (race condition possible).
  3. Import reservation pattern: reserve before Shopify call, update after (safe under concurrency).
  4. Shopify metafield-only dedup (API call overhead, no reservation).
- **Decision:** Import reservation pattern (primary) + Shopify product metafield (secondary verification for reconciliation).
- **Design:**
  1. **Reserve:** `BEGIN IMMEDIATE` → `INSERT import_attempts (status='pending')` → `COMMIT`. The `UNIQUE` index on `(store_id, source_product_id, status)` combined with application logic prevents two concurrent `pending` records.
  2. **If reservation fails** (existing `completed` or `pending` record): Return `409` with existing product info or "import in progress" message.
  3. **Execute:** Call Shopify `productSet` mutation. Include source product ID as a metafield.
  4. **On success:** `UPDATE import_attempts SET status='completed', shopify_product_id=...`.
  5. **On definitive failure** (Shopify `userErrors`): `UPDATE status='failed'`. Failed records can be deleted to allow retry.
  6. **On timeout/unknown outcome:** `UPDATE status='needs_reconciliation'`.
  7. **Reconciliation:** Query Shopify for products with `custom.aliexpress_source_id` metafield matching the source ID. If found → update to `completed`. If not found → delete stale attempt to allow retry.
- **Reasoning:**
  - Title matching is unreliable (titles can be similar across products).
  - Simple check-then-create has a race window between the check and the insert.
  - `BEGIN IMMEDIATE` in SQLite acquires a write lock at transaction start, serializing concurrent writes.
  - Metafield provides a secondary source of truth in Shopify that survives backend database loss.
- **Consequences:** Slightly more complex than a simple unique constraint on completed records, but prevents all identified race conditions and handles ambiguous timeout scenarios.

---

## ADR-009: Shopify API Version

- **Status:** Accepted
- **Verified:** 2026-10-29. Confirm the latest stable version at implementation start.
- **Context:** Shopify API is versioned quarterly. Each version is supported for ~12 months.
- **Decision:** Pin to `2026-01` (stable version at planning time).
- **Action required:** Before M2 implementation begins, verify the currently supported Shopify API version and `productSet` schema against Shopify's API changelog. If `2026-01` is no longer the recommended version, update ADR and all configuration to the current stable version.
- **Upgrade policy:** Do not auto-upgrade. When the pinned version approaches end-of-support, create a new ADR with migration notes and test the new version before switching.
- **Consequences:** Must maintain version consistency across all config, docs, and tests.

---

## ADR-010: Image Handling Strategy

- **Status:** Accepted (resolved from Pending)
- **Context:** AliExpress product images are hosted on AliExpress CDN. Shopify's `productSet` mutation accepts external image URLs via the `files` field with `originalSource`. It is unknown whether Shopify's server-side fetcher can reliably retrieve images from AliExpress CDN.
- **Decision:**
  1. **Primary:** Pass AliExpress image URLs directly to Shopify's `productSet` `files.originalSource`. Shopify fetches the images server-side.
  2. **Fallback:** If Shopify returns image-specific errors (media processing failure), the backend downloads images server-side and uses Shopify's staged upload API (`stagedUploadsCreate` → upload → reference by GID).
  3. **Validation gate:** During M6-05, test direct URL pass-through with at least 3 different AliExpress products. If direct pass-through fails consistently, switch the primary strategy to staged upload and update this ADR.
- **Image outcome semantics:**
  - **All images succeed:** Full success. Response includes `images_succeeded == images_requested`.
  - **Some images fail:** Partial success. Product is created. Response includes `images_succeeded < images_requested` and `images_failed` count. UI shows a warning.
  - **All images fail:** Product is still created (text content is more important than images). Response flags `images_succeeded == 0`. UI shows a prominent warning.
  - **Image failure never blocks product creation.** The user can manually add images in Shopify Admin.
- **Image validation (server-side fetch path):**
  - HTTPS only.
  - Allowlisted hostnames: `ae01.alicdn.com`, `ae04.alicdn.com`, `img.alicdn.com`, `*.alicdn.com`.
  - DNS resolution checked: reject private, loopback, link-local, and reserved IP ranges.
  - No redirect following (or max 1 redirect, re-validated against allowlist and IP check).
  - Content-Type must be `image/*`.
  - Max 10 MB per image.
  - Max 50 images per product.
  - Timeout: 10 seconds per image.
- **Consequences:** Partial image success is a documented, expected outcome. The UI must distinguish full success from partial success. README and plan must not promise "all images transferred."

---

## ADR-011: Pricing, Currency, and Markup

- **Status:** Accepted
- **Context:** AliExpress displays prices in the user's selected currency. The extension extracts the displayed price. The user applies a markup percentage. Shopify stores prices in the store's currency.
- **Decision:**
  1. **Extract source currency:** The content script must extract the displayed currency code alongside the price. Currency is identified from page metadata, JSON-LD `priceCurrency`, or visible currency symbols/codes.
  2. **Fetch store currency:** After OAuth, the backend queries `shop { currencyCode }` and caches the result in the `stores` table.
  3. **Currency matching (MVP):** Import is permitted only when the extracted source currency matches the Shopify store currency. If they differ, the import is blocked with a clear message: "Source currency (CNY) does not match your store currency (USD). Please change your AliExpress currency setting."
  4. **Markup formula:** `Selling Price = Source Cost × (1 + Markup% / 100)`.
  5. **Money arithmetic:** Use integer arithmetic on cents (multiply price × 100, compute, then divide). Alternatively, use a decimal library. Never use binary floating-point for money.
  6. **Rounding:** Round to 2 decimal places using half-up rounding (standard commercial rounding).
  7. **Price format:** Transmit prices as strings (e.g., `"16.87"`) in API contracts to avoid JSON floating-point issues.
  8. **Unknown currency:** If the content script cannot determine the source currency, the import is blocked with an error.
  9. **Preview display:** The popup shows source currency, source price, markup percentage, and final selling price — all with explicit currency codes.
- **Reasoning:**
  - Automatic currency conversion is out of scope and error-prone (requires exchange rate source, staleness policy, rounding policy).
  - A numeric amount without its currency is ambiguous and can create materially incorrect prices.
  - Blocking on mismatch is the safest MVP behavior — it forces the user to align currencies before import.
  - Integer/decimal arithmetic eliminates floating-point rounding errors.
- **Consequences:** Users whose AliExpress display currency differs from their Shopify store currency must change their AliExpress currency setting before importing. This is documented as a setup requirement.

---

## ADR-012: Extension-Backend Authentication

- **Status:** Accepted
- **Context:** The Chrome Extension makes requests to the backend server. These requests must be authenticated to prevent unauthorized access.
- **Options:**
  1. API key stored in extension `chrome.storage`.
  2. Session-based authentication after Shopify OAuth.
  3. JWT tokens issued after Shopify OAuth, with direct fragment handoff.
  4. Short-lived authorization code exchange for JWT.
- **Decision:** Short-lived, single-use authorization code exchanged for a JWT.
- **Auth callback flow:**
  1. Backend completes Shopify OAuth token exchange.
  2. Backend generates a single-use authorization code (random 32-byte hex), stores it with a 60-second expiry.
  3. Backend redirects to `chrome-extension://<EXTENSION_ID>/src/popup/auth-callback.html?code=<auth_code>`.
  4. The extension's auth-callback page extracts the code from the URL query parameter.
  5. The extension immediately calls `POST /auth/exchange` with the code.
  6. The backend validates the code (single-use, not expired), deletes it, and returns a JWT.
  7. The extension stores the JWT in `chrome.storage.local`.
  8. The extension clears the URL/code from memory.
- **JWT contents:** `{ storeDomain, storeId, iat, exp }`. Expiry: 7 days.
- **JWT does not contain:** Shopify access tokens, client secrets, or any Shopify credentials.
- **Reasoning:**
  - Direct JWT in URL fragment exposes a long-lived bearer credential in the URL.
  - A short-lived, single-use code limits the exposure window to 60 seconds.
  - The exchange happens over a direct extension→backend request (not via URL).
  - JWTs are stateless and don't require server-side session storage after issuance.
  - 7-day expiry balances usability (user doesn't re-auth constantly) with security.
- **Consequences:** Backend must store temporary auth codes (in-memory map with TTL cleanup). Extension must handle JWT expiry and prompt re-authentication.

---

## ADR-013: Single-Store MVP Behavior

- **Status:** Accepted
- **Context:** The MVP targets single-store use. The database schema has a `stores` table that could technically hold multiple stores. The behavior when a user connects a second store must be explicitly defined.
- **Decision:**
  - Only one store may be active at a time (`is_active = 1`).
  - Connecting a new store deactivates the previous store (`is_active = 0`).
  - Import history for the deactivated store is preserved but not queryable from the extension.
  - The extension always operates against the single active store.
  - The popup shows the active store name. If the user wants to switch stores, they disconnect and reconnect.
- **Reasoning:** Multi-store support adds UI complexity (store selector), API routing complexity, and scope creep. For MVP, one active store is sufficient.
- **Consequences:** Users who need multi-store support must run separate backend instances (documented limitation).

---

## ADR-014: Product Envelope Limits

- **Status:** Accepted
- **Context:** AliExpress products vary widely in size. Shopify has its own limits. The API request size and mutation complexity must be bounded.
- **Decision — MVP supported product envelope:**

  | Dimension | Limit | Rationale |
  |-----------|-------|-----------|
  | Title length | 255 characters | Shopify limit |
  | Description HTML | 50,000 characters | Reasonable limit; Shopify allows more but we cap for safety |
  | Option types | 3 maximum | Shopify hard limit |
  | Variants | 2,000 maximum | Shopify limit |
  | Images | 50 maximum | Practical limit for single import |
  | Image file size | 10 MB each | Shopify and performance |
  | Total request body | 1 MB (API JSON) | Express default; sufficient for metadata |

- **Behavior for exceeding limits:**
  - **>3 option types:** Import **rejected** before Shopify mutation. Error: "This product has X option types. Shopify supports a maximum of 3. This product cannot be imported." No silent truncation.
  - **>2000 variants / >50 images / title too long:** Import rejected with specific limit violation.
  - **Description too long:** Truncated with a warning (non-critical; user can edit in Shopify).
- **Reasoning:** Rejecting unsupported products is safer than silently altering them. A product with truncated options would have incorrect variant↔price mappings.
- **Consequences:** Some AliExpress products with many option types cannot be imported. This is a documented limitation.
