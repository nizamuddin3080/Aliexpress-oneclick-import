# Audit Findings and Remediation Report

**Project:** AliExpress to Shopify One-Click Importer  
**Audit Basis:** Cross-document requirements, architecture, concurrency, security, and testing review  
**Date:** 2026-10-29  
**Status:** All 20 findings (P0, P1, P2) addressed and incorporated across canonical planning specifications.

---

## 1. Summary of Remediations

| Finding ID | Priority | Description | Remediation Applied | Canonical Files Updated |
|---|---|---|---|---|
| **F-01** | **P0** | Duplicate prevention unsafe under concurrency and timeouts | Implemented import reservation pattern (`pending` → `completed` / `failed` / `needs_reconciliation`) with SQLite `BEGIN IMMEDIATE` write serialization. | `architecture.md`, `database-schema.md`, `api-spec.md`, `decisions.md`, `tasks.md`, `rules.md` |
| **F-02** | **P0** | Price currency missing from import contract | Included `sourceCurrency` in extraction & API contracts. Matched against store base currency; blocked on mismatch. Enforced decimal-safe arithmetic with half-up rounding. | `plan.md`, `api-spec.md`, `design.md`, `decisions.md`, `testing.md`, `rules.md` |
| **F-03** | **P0** | Underspecified/inconsistent Shopify auth & token lifecycle | Pinned to Shopify Dev Dashboard Custom App with offline access tokens. Encrypted at rest (AES-256-GCM); defined revocation and reauthorization flow. | `decisions.md`, `architecture.md`, `database-schema.md`, `deployment.md`, `api-spec.md` |
| **F-04** | **P0** | Silent option truncation corrupts variant data | Strict policy: products with > 3 option dimensions are explicitly **rejected** before Shopify mutation; silent truncation prohibited. | `plan.md`, `architecture.md`, `rules.md`, `design.md`, `tasks.md`, `testing.md` |
| **F-05** | **P0** | Image success criteria conflict with partial success | Discrete outcomes defined: `completed` (all images OK) vs `completed_partial_images` (product created, some images failed). Exact counts surfaced in UI. | `README.md`, `plan.md`, `architecture.md`, `decisions.md`, `api-spec.md`, `design.md` |
| **F-06** | **P1** | API retry rules repeat non-idempotent creation | Banned automatic blind retries of `productSet`. Timed-out attempts marked `needs_reconciliation`; retry queries Shopify by source ID metafield before reserving. | `api-spec.md`, `architecture.md`, `tasks.md`, `rules.md` |
| **F-07** | **P1** | OAuth callback exposes JWT in URL fragment | Replaced fragment handoff with single-use authorization code (32-byte hex, 60s TTL), exchanged via `POST /auth/exchange` for a 7-day JWT. | `api-spec.md`, `architecture.md`, `decisions.md`, `deployment.md`, `tasks.md` |
| **F-08** | **P1** | SSRF protections need DNS resolution and redirect checks | Created `safeFetch` engine specification: pre-resolution DNS check blocking loopback, private, link-local, and multicast IP ranges; redirect revalidation; size cap. | `rules.md`, `architecture.md`, `api-spec.md`, `testing.md`, `tasks.md` |
| **F-09** | **P1** | URL validation tests allowed insecure HTTP | Enforced HTTPS-only on all AliExpress source URLs and image CDN URLs. Updated test suite so HTTP URLs fail. | `testing.md`, `rules.md`, `api-spec.md`, `plan.md` |
| **F-10** | **P1** | Product validation and request limits misaligned | Defined supported MVP envelope (title 255 chars, description 50KB, max 3 options, max 2000 variants, max 50 images @ 10MB each, 1MB JSON body). | `plan.md`, `api-spec.md`, `rules.md`, `decisions.md`, `tasks.md` |
| **F-11** | **P1** | Shopify API version freshness verification | Pinned Admin GraphQL API to `2026-01`; documented changelog verification task in M5 and no-auto-upgrade policy in ADR-009. | `decisions.md`, `deployment.md`, `plan.md`, `architecture.md` |
| **F-12** | **P1** | Ambiguous multi-store vs single-store behavior | Defined single-store active model: connecting Store B marks Store A as `is_active = 0`; disconnect zeroes out token; documented in ADR-013. | `database-schema.md`, `rules.md`, `plan.md`, `decisions.md`, `deployment.md` |
| **F-13** | **P1** | Extension ID setup fragile across dev & prod | Documented separate dev (unpacked 32-char ID) and prod (published ID) configurations; backend validates pinned `EXTENSION_ID` and rejects arbitrary redirects. | `deployment.md`, `api-spec.md`, `decisions.md`, `tasks.md` |
| **F-14** | **P1** | Indistinguishable API outcome states | Added discrete outcome codes: `completed`, `completed_partial_images`, `needs_reconciliation`, `failed`; each with explicit UI representations and retry flags. | `api-spec.md`, `design.md`, `architecture.md` |
| **F-15** | **P1** | Unexplained metafields test in testing suite | Scoped metafield testing strictly to internal source tracking (`custom.aliexpress_source_*`); removed arbitrary merchant metafield test cases. | `testing.md` |
| **F-16** | **P2** | Previous audit report overstated confidence | Replaced previous `planning-audit.md` with transparent finding-by-finding evaluation and honest risk assessment. | `planning-audit.md` |
| **F-17** | **P2** | Uploaded filenames differed from canonical links | Normalized all file references to canonical names (`plan.md`, `architecture.md`, `decisions.md`, etc.). | All 12 canonical documents |
| **F-18** | **P2** | Task estimates and planning baseline lacked evidence | Re-anchored tasks with dependencies (M0-01 through M9-06); gated Phase B on explicit task `M0-16`; linked to ADRs and specs. | `tasks.md` |
| **F-19** | **P2** | Operational logging, retention, and backups high-level | Documented SQLite backup command (`sqlite3 .backup`), integrity verification (`PRAGMA integrity_check`), persistent volume mandate, and token wiping. | `database-schema.md`, `deployment.md`, `rules.md` |
| **F-20** | **P2** | Merchant copyright & source responsibility unstated | Added explicit Merchant Legal and Compliance Notice advising users that they are responsible for supplier rights and content reuse permissions. | `plan.md`, `rules.md`, `README.md` |

---

## 2. Authorization Status

Task `M0-16` ("Obtain user approval for Phase B") has been officially authorized by the user. Implementation may now commence with **Milestone M1: Project Scaffolding and Development Environment**.
