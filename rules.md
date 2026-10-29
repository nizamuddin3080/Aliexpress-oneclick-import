# Engineering Rules — AliExpress to Shopify One-Click Importer

## 1. Documentation-First Development

- Every feature and contract change must be documented before code implementation.
- Architecture modifications require prior updates to `architecture.md`, `decisions.md`, and `api-spec.md`.
- No implementation begins until Phase A is explicitly approved by the user.

## 2. Scope Control

- This is a **single-product, one-click Draft importer** for a single active store.
- Do not implement bulk import, merchant dashboards, inventory sync, order fulfillment, multi-store engines, or billing systems.
- If a task is not specified in `tasks.md`, it shall not be implemented.
- Scope expansions require written rationale and user approval.

## 3. Approval Gates

- Phase A (Planning & Remediation) must be fully reviewed and explicitly approved before Phase B (Implementation) commences.
- Destructive schema migrations or API contract breaking changes require user confirmation.
- Task `M0-16` ("Obtain user approval for Phase B") must remain unchecked until explicit authorization is given.

## 4. TypeScript Strict Mode

- All TypeScript code (extension and server) must compile under `"strict": true`.
- Zero `any` types permitted; use strictly defined interfaces and unions.
- No `@ts-ignore` or `@ts-expect-error` without an explanatory comment detailing the compiler limitation.

## 5. Code Quality and Style

- `camelCase` for variables, functions, and properties.
- `PascalCase` for classes, types, interfaces, and React/component files.
- `UPPER_SNAKE_CASE` for environment variables and module constants.
- Maximum function length: 50 lines (excluding JSDoc comments); refactor if longer.
- Every exported function and class must feature complete JSDoc documentation.

## 6. Input Validation and Untrusted Data

- All data extracted from AliExpress is treated as **untrusted input**.
- Sanitize HTML descriptions client-side (DOMPurify) and server-side (sanitize-html) before sending to Shopify.
- Strip all `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, inline event handlers (`onload`, `onerror`), and tracking pixels.
- Validate all strings, numbers, arrays, and URLs against strict schemas before processing.

## 7. Currency and Pricing Integrity

- Extracted product data must include the source display currency (ISO 4217).
- Never apply markup to an amount in an unknown or mismatched currency.
- If AliExpress currency differs from the connected Shopify store currency, **stop and block import**.
- Never perform money calculations using binary floating-point numbers (`0.1 + 0.2`).
- Use integer arithmetic on cents or a dedicated decimal library (e.g., `decimal.js`).
- Apply standard commercial half-up rounding to 2 decimal places.
- Prices must be transmitted in API payloads as formatted decimal strings (e.g., `"19.99"`).

## 8. Variant and Option Mapping Integrity

- Shopify enforces a hard limit of 3 option dimensions per product.
- **Never silently truncate, merge, or drop option types.**
- If an AliExpress product contains more than 3 option dimensions, **reject the import** with an explicit error.
- Every variant must possess an explicit positive price; never invent or guess missing variant prices.

## 9. Duplicate Prevention and Concurrency

- Enforce the **import reservation pattern**: insert a `pending` attempt record in SQLite before initiating the Shopify mutation.
- Execute reservations within a `BEGIN IMMEDIATE` transaction to guarantee write serialization.
- If a reservation already exists:
  - `status: 'completed'` → Return `409 DUPLICATE_PRODUCT` with Shopify Admin link.
  - `status: 'pending'` (< 5 min old) → Return `409 IMPORT_IN_PROGRESS`.
  - `status: 'needs_reconciliation'` → Reconcile against Shopify before allowing a new attempt.
- Do not hold SQLite transactions open across external HTTP requests.

## 10. Ambiguous Mutation Outcomes & No Blind Retries

- A network timeout or server restart during a Shopify mutation leaves the outcome unknown.
- In this scenario, set attempt status to `needs_reconciliation`.
- **Never perform an automatic blind retry** of `productSet` when the outcome is uncertain.
- Surface an uncertain outcome message directing the user to verify in Shopify Admin.
- Perform automated reconciliation (querying Shopify by source ID metafield) prior to permitting subsequent import attempts.

## 11. Image Handling and Transparency

- Transparently track requested vs. succeeded image uploads (`images_requested`, `images_succeeded`, `images_failed`).
- Never claim all images imported successfully unless verified by Shopify response.
- Partial image failure produces a `completed_partial_images` outcome with clear user-facing warnings.
- Image failure does not block Draft product creation; merchant can attach images manually in Shopify Admin.

## 12. Secret Management

- **Absolute prohibition of credentials in extension code:** No Shopify access tokens, client secrets, JWT signing secrets, or encryption keys in extension JavaScript, HTML, or committed files.
- Store Shopify access tokens encrypted at rest (AES-256-GCM) in the backend SQLite database.
- Keep server secrets in `.env` (gitignored). Provide a `.env.example` with dummy values.
- Extension receives only a short-lived authorization code upon OAuth completion, exchanged via POST for a 7-day JWT.

## 13. Absolute Prohibition of Automatic Publishing

- Products must be created with `status: "DRAFT"`.
- There is no code path, configuration flag, or override that sets product status to `"ACTIVE"`.
- The merchant retains sole authority to review and publish products in Shopify Admin.

## 14. Safe Scraping and Ethical Data Access

- Do not attempt to bypass CAPTCHAs, bot protection systems, or login barriers.
- Do not reverse-engineer private, authenticated internal APIs (e.g., MTOP session tokens).
- Rely solely on structured data available on public detail pages (embedded state scripts, JSON-LD, rendered DOM).
- If extraction fails due to dynamic protection, surface an explicit failure message rather than attempting evasive circumvention.

## 15. URL Validation and SSRF Protection

- Enforce HTTPS for all AliExpress source URLs and image URLs.
- Allowlist hostnames:
  - Source: `aliexpress.com`, `*.aliexpress.com`, `aliexpress.ru`, `*.aliexpress.ru`.
  - Images: `ae01.alicdn.com`, `ae04.alicdn.com`, `img.alicdn.com`, `*.alicdn.com`.
- Safe-fetch requirements for server-side fetches:
  - Resolve DNS and verify IP does NOT fall into loopback (`127.0.0.0/8`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`), or multicast ranges.
  - Defend against DNS rebinding by connecting directly to the validated IP with appropriate Host header.
  - Revalidate every redirect against protocol, hostname, and resolved IP rules (max 1 redirect).
  - Reject URLs with userinfo (`user:pass@host`).
  - Cap download size at 10 MB per image and timeout at 10 seconds.

## 16. Shopify API Versioning

- Pin Admin GraphQL API version to `2026-01` (to be verified at implementation start).
- Use stable, modern mutations (`productSet`).
- Upgrade API versions only through documented architectural decisions.

## 17. Single Active Store Model

- The backend operates with at most one active store (`is_active = 1`).
- Connecting a new store marks the previously active store as inactive.
- Disconnecting a store securely wipes and overwrites the stored access token.

## 18. Chrome Extension Permissions

- Request only essential permissions: `activeTab`, `scripting`, `storage`.
- Restrict content script match patterns strictly to AliExpress item detail pages.
- Do not request broad `<all_urls>` or `webRequest` permissions.

## 19. Logging and Error Safety

- Never log access tokens, decryption keys, full JWT strings, or merchant secrets.
- Redact authorization headers in server logs.
- Return user-friendly error messages; never expose raw backend stack traces or internal database paths to the client.

## 20. Legal and Content Responsibility

- Include explicit merchant advisory: user is responsible for supplier permissions and copyright compliance regarding imported content.
