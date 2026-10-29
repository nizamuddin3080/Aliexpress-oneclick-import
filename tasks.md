# Implementation Tasks — AliExpress to Shopify One-Click Importer

## Status Key

- `[ ]` Not started
- `[x]` Completed
- `[!]` Blocked

---

## M0: Repository Inspection, Remediation, and Planning Approval

| ID | Task | Dependencies | Expected Outcome | Acceptance Criteria | Test | Status |
|----|------|-------------|-------------------|---------------------|------|--------|
| M0-01 | Inspect existing repository | None | Repository state documented | Empty repository confirmed | Manual | [x] |
| M0-02 | Research Shopify GraphQL Admin API | None | Current API version & mutations documented | `productSet` mutation & Custom App OAuth verified | Manual | [x] |
| M0-03 | Research AliExpress data extraction methods | None | Extraction fallbacks analyzed | `window.runParams`, JSON-LD, DOM limits identified | Manual | [x] |
| M0-04 | Initial planning documents creation | M0-01 | Initial Markdown files drafted | 12 planning docs created | Manual | [x] |
| M0-05 | Detailed Documentation Audit Review | M0-04 | Audit report with 20 findings (P0–P2) | Findings F-01 through F-20 cataloged | Audit | [x] |
| M0-06 | Remediate F-01 & F-06 (Reservation & Retries) | M0-05 | Concurrency reservation & no blind retry spec | State machine & SQLite IMMEDIATE design in docs | Review | [x] |
| M0-07 | Remediate F-02 (Currency Contract) | M0-05 | Currency extraction & match requirement | Store currency check & integer math documented | Review | [x] |
| M0-08 | Remediate F-03 & F-07 (Auth & Handoff) | M0-05 | Offline token OAuth & 60s auth code exchange | Dev Dashboard flow & secure exchange in docs | Review | [x] |
| M0-09 | Remediate F-04 (Variant Truncation) | M0-05 | Strict 3-option rejection policy | No silent truncation policy across all docs | Review | [x] |
| M0-10 | Remediate F-05 & F-14 (Image Transparency) | M0-05 | Partial image success & outcome states | `completed_partial_images` & warnings specified | Review | [x] |
| M0-11 | Remediate F-08 & F-09 (SSRF & HTTPS) | M0-05 | Safe fetch DNS/IP check & HTTPS-only rule | Strict allowlist & loopback filter documented | Review | [x] |
| M0-12 | Remediate F-10, F-12, F-13 (Envelope & Dev/Prod) | M0-05 | Product limits, single-store, EXTENSION_ID | Limits & configuration documented | Review | [x] |
| M0-13 | Remediate F-15 (Remove Metafields Test) | M0-05 | Scope-aligned test suite | Rogue tests removed; only MVP tests remain | Review | [x] |
| M0-14 | Remediate F-16–F-20 (Honest Audit & Operations) | M0-05 | Updated `planning-audit.md` with finding matrix | All 20 findings tracked with exact statuses | Review | [x] |
| M0-15 | Synchronize all 12 Markdown files | M0-06..M0-14 | Zero contradictions across all docs | Cross-document matrix verified | Review | [x] |
| M0-16 | **Obtain user approval for Phase B** | M0-15 | Explicit authorization to begin Phase B | User provides unambiguous go-ahead | Gate | [x] |

---

## M1: Project Scaffolding and Development Environment

| ID | Task | Dependencies | Expected Outcome | Acceptance Criteria | Test | Status |
|----|------|-------------|-------------------|---------------------|------|--------|
| M1-01 | Initialize git repository | M0-16 | Git repo initialized with `.gitignore` | `node_modules`, `.env`, `*.db`, `dist/` excluded | Manual | [x] |
| M1-02 | Create extension scaffold | M0-16 | Directory structure for extension | `popup/`, `content/`, `background/`, `shared/` | Manual | [x] |
| M1-03 | Create server scaffold | M0-16 | Directory structure for server | `routes/`, `services/`, `shopify/`, `db/` | Manual | [x] |
| M1-04 | Configure extension TypeScript | M1-02 | `tsconfig.json` with strict mode | `"strict": true`, DOM & webworker types | `tsc --noEmit` | [x] |
| M1-05 | Configure server TypeScript | M1-03 | `tsconfig.json` with strict mode | `"strict": true`, Node.js target | `tsc --noEmit` | [x] |
| M1-06 | Configure esbuild for extension | M1-04 | Build pipeline for content, SW, popup | Produces `dist/` assets clean of secrets | `npm run build` | [x] |
| M1-07 | Configure build for server | M1-05 | Build pipeline for Express server | Compiles TypeScript server to `dist/` | `npm run build` | [x] |
| M1-08 | Create Manifest V3 `manifest.json` | M1-02 | Valid MV3 configuration | Minimal permissions: `activeTab`, `scripting`, `storage` | Load in Chrome | [x] |
| M1-09 | Install runtime & dev dependencies | M1-02, M1-03 | Dependencies installed via package.json | Zero high/critical vulnerabilities | `npm audit` | [x] |
| M1-10 | Create `server/.env.example` | M1-03 | Complete environment template | All variables present with dummy placeholders | Manual | [x] |
| M1-11 | Configure Vitest test runner | M1-09 | Vitest setup for server & extension | Smoke test passes | `npm test` | [x] |
| M1-12 | Verify server startup & health check | M1-07, M1-10 | Express runs on port 3456 | `GET /health` returns `{ status: "ok" }` | `curl` test | [x] |

---

## M2: Shopify Authentication and Secure Token Lifecycle

| ID | Task | Dependencies | Expected Outcome | Acceptance Criteria | Test | Status |
|----|------|-------------|-------------------|---------------------|------|--------|
| M2-01 | Initialize SQLite database in WAL mode | M1-09 | Database engine with migration runner | Creates `stores` & `import_attempts` tables | Unit test | [ ] |
| M2-02 | Implement AES-256-GCM token encryption | M1-09 | Encrypt/decrypt helper module | Round-trip encrypts and recovers token | Unit test | [ ] |
| M2-03 | Implement `GET /auth/shopify` | M1-12 | Initiates OAuth flow with Shopify | Validates domain, generates CSRF nonce | Unit test | [ ] |
| M2-04 | Implement OAuth HMAC & state validation | M2-03 | Callback security validation | Rejects tampered HMAC or replayed state | Unit test | [ ] |
| M2-05 | Implement token exchange & store currency query | M2-04 | Obtains offline token & queries shop | Stores encrypted token and store currency | Integration | [ ] |
| M2-06 | Implement single-store enforcement | M2-05 | Deactivates previous active store | Only 1 store has `is_active = 1` | Unit test | [ ] |
| M2-07 | Implement short-lived auth code generation | M2-05 | 32-byte code with 60s TTL | Redirects to extension with `?code=...` | Unit test | [ ] |
| M2-08 | Implement `POST /auth/exchange` for JWT | M2-07 | Exchanges code for 7-day JWT | Enforces single-use; returns JWT | Integration | [ ] |
| M2-09 | Implement JWT validation middleware | M2-08 | Protects all `/api/*` endpoints | Rejects missing/expired tokens with 401 | Unit test | [ ] |
| M2-10 | Implement `GET /api/status` | M2-09 | Returns connected store name & currency | Returns store details to authenticated user | Integration | [ ] |
| M2-11 | Build extension OAuth callback handler | M1-08, M2-08 | Popup receives code and calls exchange | Stores JWT in `chrome.storage.local` | Manual E2E | [ ] |
| M2-12 | Implement secure token wipe on disconnect | M2-01 | Disconnect endpoint overwrites token | Zeroes out token fields in SQLite | Unit test | [ ] |

---

## M3: AliExpress Product & Currency Extraction

| ID | Task | Dependencies | Expected Outcome | Acceptance Criteria | Test | Status |
|----|------|-------------|-------------------|---------------------|------|--------|
| M3-01 | Define `ExtractedProduct` interface | M1-04 | Shared TypeScript type definition | Includes `sourceCurrency`, variants, options | Typecheck | [ ] |
| M3-02 | Implement script state parser | M1-04 | Extracts `window.runParams` or SSR state | Extracts title, options, prices, currency | Unit test | [ ] |
| M3-03 | Implement JSON-LD schema extractor | M1-04 | Parses `application/ld+json` blocks | Extracts fallback title, price, currency | Unit test | [ ] |
| M3-04 | Implement rendered DOM element extractor | M1-04 | Scrapes visible price, title, thumbnails | Handles client-rendered DOM layout | Unit test | [ ] |
| M3-05 | Implement main-world bridge script | M3-02 | Injects script to read window variables | Safely posts data to content script | Manual E2E | [ ] |
| M3-06 | Implement multi-strategy orchestrator | M3-02..M3-05 | Priority chain: Script → JSON-LD → DOM | Returns best available data or error | Unit test | [ ] |
| M3-07 | Implement currency extraction & validation | M3-06 | Detects ISO 4217 code (USD, EUR, etc.) | Throws error if currency unknown | Unit test | [ ] |
| M3-08 | Implement client-side DOMPurify sanitizer | M1-09 | Strips malicious HTML from description | Removes scripts, iframes, inline handlers | Unit test | [ ] |
| M3-09 | Implement HTTPS source URL validator | M1-04 | Validates AliExpress hostname allowlist | Rejects non-HTTPS or foreign domains | Unit test | [ ] |
| M3-10 | Extract and validate AliExpress image URLs | M3-06 | Extracts HTTPS CDN URLs | Verifies `*.alicdn.com` hosts | Unit test | [ ] |
| M3-11 | Validate extraction on live AliExpress pages | M3-06, M3-10 | Tested on simple, multi-variant products | Verifies title, price, currency extracted | Manual E2E | [ ] |

---

## M4: Product Preview and Popup UI

| ID | Task | Dependencies | Expected Outcome | Acceptance Criteria | Test | Status |
|----|------|-------------|-------------------|---------------------|------|--------|
| M4-01 | Implement popup HTML layout | M1-08 | Semantic HTML matching `design.md` | Containers for all 12 UI states | Manual | [ ] |
| M4-02 | Implement popup CSS stylesheet | M4-01 | Polaris-inspired clean styling | 400×520px fixed layout, high contrast | Manual | [ ] |
| M4-03 | Implement popup state machine | M4-01 | TypeScript state controller | Handles transitions cleanly | Unit test | [ ] |
| M4-04 | Implement currency match validator | M2-10, M3-07 | Compares source currency with store | Blocks import if currencies mismatch | Unit test | [ ] |
| M4-05 | Implement unsupported product guard | M3-01 | Checks option dimension count | Displays "⛔ Unsupported" if >3 options | Unit test | [ ] |
| M4-06 | Implement decimal-safe markup calculator | M4-03 | Updates selling price in real-time | Decimal arithmetic with half-up rounding | Unit test | [ ] |
| M4-07 | Connect content script extraction to popup | M3-06, M4-03 | Message passing triggers extraction | Popup displays extracted preview | Manual E2E | [ ] |
| M4-08 | Implement loading & progress states | M4-03 | Animated feedback during extraction/import | Buttons disabled during processing | Manual E2E | [ ] |
| M4-09 | Implement full success state screen | M4-03 | Displays draft link & summary | Direct clickable link to Shopify Admin | Manual E2E | [ ] |
| M4-10 | Implement partial image success screen | M4-03 | Displays draft link + image warning | Warns merchant of failed images | Manual E2E | [ ] |
| M4-11 | Implement uncertain outcome screen | M4-03 | Explains timeout; no blind retry | Provides Shopify Admin products link | Manual E2E | [ ] |
| M4-12 | Implement keyboard & screen-reader a11y | M4-01 | WCAG AA compliance | Tab order, ARIA live regions verified | Manual | [ ] |

---

## M5: Shopify Product Creation & Import Reservation

| ID | Task | Dependencies | Expected Outcome | Acceptance Criteria | Test | Status |
|----|------|-------------|-------------------|---------------------|------|--------|
| M5-01 | Implement Shopify Admin GraphQL client | M2-05 | Reusable GraphQL POST utility | Pinned to API version `2026-01` | Unit test | [ ] |
| M5-02 | Implement `import_attempts` reservation | M2-01 | `BEGIN IMMEDIATE` reservation insert | Prevents concurrent duplicate runs | Unit test | [ ] |
| M5-03 | Implement server-side input validation | M1-09 | Schema validator for import payload | Enforces limits, HTTPS, currency match | Unit test | [ ] |
| M5-04 | Implement server-side HTML sanitizer | M1-09 | `sanitize-html` defense-in-depth | Strips XSS vectors from descriptions | Unit test | [ ] |
| M5-05 | Build `productSet` mutation payload | M5-01 | Constructs GraphQL mutation input | `status: DRAFT`, options, variants, files | Unit test | [ ] |
| M5-06 | Execute product creation service | M5-02, M5-05 | Sends mutation and processes result | Updates attempt to `completed` or `failed` | Integration | [ ] |
| M5-07 | Handle Shopify GraphQL `userErrors` | M5-06 | Parses field errors into clean text | Returns HTTP 422 with readable errors | Unit test | [ ] |
| M5-08 | Implement timeout & uncertain outcome guard | M5-06 | Flags `needs_reconciliation` on timeout | Returns `502 UNKNOWN_OUTCOME` | Unit test | [ ] |
| M5-09 | End-to-end Draft product creation test | M5-06 | Product appears in Shopify Admin | Status is strictly Draft, not Active | Manual E2E | [ ] |

---

## M6: Variant Mapping, Envelope Limits, and Images

| ID | Task | Dependencies | Expected Outcome | Acceptance Criteria | Test | Status |
|----|------|-------------|-------------------|---------------------|------|--------|
| M6-01 | Implement variant matrix generator | M5-05 | Maps AliExpress options to Shopify format | Generates `productOptions` & variants | Unit test | [ ] |
| M6-02 | Enforce 3-option limit rejection | M6-01 | Rejects products with 4+ options | Rejects before calling Shopify | Unit test | [ ] |
| M6-03 | Enforce supported product envelope limits | M5-03 | Enforces limits on title, variants, body | Rejects oversized product payloads | Unit test | [ ] |
| M6-04 | Implement direct image pass-through | M5-05 | Passes CDN image URLs to `files` field | Attaches images via `originalSource` | Unit test | [ ] |
| M6-05 | Validate direct image pass-through (Spike) | M6-04, M5-09 | Verifies if Shopify fetches AliExpress CDN | Records result; triggers M6-06 if blocked | Manual E2E | [ ] |
| M6-06 | Implement server-side staged upload fallback | M6-05 | Safe fetch + `stagedUploadsCreate` | Used if direct image fetch fails | Integration | [ ] |
| M6-07 | Implement image outcome accounting | M6-04 | Tracks requested vs succeeded images | Returns `completed_partial_images` if some fail | Unit test | [ ] |
| M6-08 | Attach source tracking metafields | M5-05 | Attaches source ID and URL metafields | Saved under `custom.aliexpress_source_*` | Integration | [ ] |

---

## M7: Pricing Integrity & Duplicate Reconciliation

| ID | Task | Dependencies | Expected Outcome | Acceptance Criteria | Test | Status |
|----|------|-------------|-------------------|---------------------|------|--------|
| M7-01 | Implement decimal-safe money library | M1-09 | Exact integer cents or `decimal.js` | Zero floating-point rounding errors | Unit test | [ ] |
| M7-02 | Implement variant price validation | M7-01 | Validates that every variant has price | Stops import if any price missing | Unit test | [ ] |
| M7-03 | Implement `GET /api/import/:sourceId` | M5-02 | Checks existing status in database | Returns `completed`, `pending`, or `none` | Unit test | [ ] |
| M7-04 | Implement automated reconciliation query | M5-01 | Queries Shopify by source ID metafield | Resolves `needs_reconciliation` attempts | Integration | [ ] |
| M7-05 | Enforce pre-mutation duplicate check | M7-03, M7-04 | Checks database and reconciles first | Returns 409 if already imported | Unit test | [ ] |
| M7-06 | Concurrency stress test | M7-05 | 2 parallel requests for same item | Exactly 1 product created in Shopify | Integration | [ ] |

---

## M8: Testing, Security Hardening, and Error Recovery

| ID | Task | Dependencies | Expected Outcome | Acceptance Criteria | Test | Status |
|----|------|-------------|-------------------|---------------------|------|--------|
| M8-01 | Implement Safe Fetch SSRF protection | M1-09 | Validates resolved IP against private ranges | Blocks loopback, 10.x, 192.168.x, 169.254.x | Unit test | [ ] |
| M8-02 | Implement redirect revalidation | M8-01 | Re-checks protocol, host, IP on redirect | Max 1 redirect; blocks malicious redirect | Unit test | [ ] |
| M8-03 | Implement rate limiting middleware | M1-12 | Capped at 10 requests/min per store | Returns 429 when threshold exceeded | Unit test | [ ] |
| M8-04 | Implement request size limit middleware | M1-12 | JSON body capped at 1 MB | Returns 413 for oversized payloads | Unit test | [ ] |
| M8-05 | Implement strict CORS for extension origin | M1-12 | Allows only `chrome-extension://<ID>` | Rejects arbitrary origins | Unit test | [ ] |
| M8-06 | Execute complete unit test suite | M8-01..M8-05 | 100% pass across all unit tests | All pricing, validation, SSRF tests pass | `npm test` | [ ] |
| M8-07 | Execute integration & concurrency tests | M7-06, M8-06 | All integration tests pass | Reservation & reconciliation verified | `npm test` | [ ] |
| M8-08 | Full end-to-end import verification | M8-07 | Live test on real AliExpress product | Product created as Draft with variants | Manual E2E | [ ] |

---

## M9: Documentation, Operations, and Deployment

| ID | Task | Dependencies | Expected Outcome | Acceptance Criteria | Test | Status |
|----|------|-------------|-------------------|---------------------|------|--------|
| M9-01 | Finalize `README.md` | M8-08 | Accurate, comprehensive overview | Reflects final system architecture | Review | [ ] |
| M9-02 | Document Shopify Dev Dashboard setup | M8-08 | Step-by-step setup instructions | Custom distribution & OAuth setup guide | Review | [ ] |
| M9-03 | Document Extension installation | M8-08 | Unpacked extension install guide | Steps to load in Chrome and record ID | Review | [ ] |
| M9-04 | Document SQLite volume & backup ops | M8-08 | Operations, backup & restore guide | `sqlite3 .backup` & integrity check | Review | [ ] |
| M9-05 | Perform final credential & secret audit | M8-08 | Git repository verified free of secrets | No tokens or private keys in git log | Review | [ ] |
| M9-06 | Document known limitations & compliance | M8-08 | Currency, 3-option, copyright notes | Explicit merchant responsibility notes | Review | [ ] |

---

## Minimum Viable Product (MVP) Definition

The MVP is achieved upon full verification of milestones **M1 through M8**.
Milestone M9 ensures operational durability, disaster recovery, and developer handoff.

## Recommended First Task for Phase B

**`M1-01: Initialize git repository`** — followed by directory scaffolding and TypeScript strict mode configuration.
