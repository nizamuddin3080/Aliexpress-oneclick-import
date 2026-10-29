# Database Schema — AliExpress to Shopify One-Click Importer

## 1. Persistence Evaluation

### Do we need a database?

**Yes.** The following requirements necessitate server-side persistent storage:

| Requirement | Why server-side storage is needed |
|-------------|----------------------------------|
| Shopify access token storage | Tokens must not be stored in extension code or client-side storage |
| Duplicate prevention with concurrent safety | Import attempts must be reserved before calling Shopify to prevent races |
| Ambiguous-outcome reconciliation | If Shopify responds but the backend crashes before persisting, we need a record of the attempt |
| Import history | Track which products have been imported to prevent duplicates |

### Why not alternatives?

| Alternative | Why rejected |
|-------------|-------------|
| No database (Shopify metafields only) | Cannot reserve an import attempt before calling Shopify; no place for tokens |
| JSON file | No ACID guarantees; no concurrent access safety |
| Redis | Not durable by default; overkill for two small tables |
| PostgreSQL | Requires separate server process; overkill for single-store use |

### Decision

**SQLite** via `better-sqlite3` — zero-configuration, file-based, embedded, ACID-compliant, and sufficient for a single-store, single-server deployment. Uses WAL mode for safe concurrent reads.

## 2. Schema

### Table: `stores`

Stores Shopify store connection details and encrypted access tokens.

```sql
CREATE TABLE IF NOT EXISTS stores (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_domain     TEXT    NOT NULL UNIQUE,        -- e.g., "mystore.myshopify.com"
    access_token    TEXT    NOT NULL,                -- AES-256-GCM encrypted
    token_iv        TEXT    NOT NULL,                -- Initialization vector for decryption
    token_auth_tag  TEXT    NOT NULL,                -- Authentication tag for decryption
    token_type      TEXT    NOT NULL DEFAULT 'offline',  -- 'offline' (long-lived)
    token_granted_at TEXT   NOT NULL DEFAULT (datetime('now')),  -- When token was issued
    scope           TEXT    NOT NULL,                -- Granted scopes, e.g., "write_products"
    scopes_granted  TEXT    NOT NULL,                -- Exact scopes returned by Shopify
    store_name      TEXT,                            -- Display name from Shopify shop query
    store_currency  TEXT,                            -- Store currency code (e.g., "USD"), from shop query
    is_active       INTEGER NOT NULL DEFAULT 1,      -- 1 = active, 0 = replaced/disconnected
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

**Notes:**
- `shop_domain` is the unique identifier for a store.
- `access_token` is encrypted at rest using AES-256-GCM with a server-side `ENCRYPTION_KEY`.
- `token_iv` and `token_auth_tag` are stored alongside for decryption.
- `token_type` is `'offline'` — Shopify offline access tokens do not expire but can be revoked. No refresh token is needed.
- `token_granted_at` records when the token was issued for audit purposes.
- `scopes_granted` stores the exact scopes Shopify confirmed, which may differ from requested scopes.
- `store_currency` is fetched from Shopify's `shop { currencyCode }` query after OAuth and cached here.
- `is_active` supports the single-store rule: connecting a new store deactivates the previous one.
- **Single-store MVP behavior:** Only one store may have `is_active = 1` at any time. Connecting a second store sets the previous store's `is_active = 0`. Import lookups only query the active store.

### Table: `import_attempts`

Tracks the lifecycle of every import attempt for concurrent safety and ambiguous-outcome reconciliation.

```sql
CREATE TABLE IF NOT EXISTS import_attempts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id            INTEGER NOT NULL REFERENCES stores(id),
    source_product_id   TEXT    NOT NULL,            -- AliExpress product ID
    source_url          TEXT    NOT NULL,            -- Full AliExpress product URL
    status              TEXT    NOT NULL DEFAULT 'pending',
        -- 'pending'                — Reserved, Shopify mutation not yet sent
        -- 'completed'              — Shopify product created and confirmed
        -- 'failed'                 — Shopify mutation returned a definitive error
        -- 'needs_reconciliation'   — Shopify mutation sent but outcome unknown (timeout/crash)
    shopify_product_id  TEXT,                        -- Shopify GID, e.g., "gid://shopify/Product/123"
    shopify_admin_url   TEXT,                        -- Direct link to Shopify admin product page
    product_title       TEXT    NOT NULL,            -- Product title at time of import
    source_currency     TEXT    NOT NULL,            -- Currency of extracted prices (e.g., "USD")
    markup_percentage   REAL    NOT NULL,            -- Applied markup percentage
    images_requested    INTEGER NOT NULL DEFAULT 0,  -- Number of images sent to Shopify
    images_succeeded    INTEGER,                     -- Number of images Shopify confirmed (null if unknown)
    error_message       TEXT,                        -- Error details for failed/reconciliation states
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),

    -- Only ONE non-failed attempt per source product per store
    -- This prevents concurrent requests from both reserving
    UNIQUE(store_id, source_product_id, status) 
        -- Note: SQLite partial indexes are limited. 
        -- Enforced via application logic + the check below.
);

-- Composite index for fast duplicate lookups
CREATE INDEX IF NOT EXISTS idx_attempts_source
    ON import_attempts(store_id, source_product_id, status);
```

**Import State Machine:**

```
┌─────────┐    Reserve (INSERT)    ┌─────────┐
│  (none) │ ──────────────────────>│ pending │
└─────────┘                        └────┬────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
              Shopify success    Shopify definitive    Timeout / crash /
              + response OK      error returned       unknown outcome
                    │                   │                   │
                    ▼                   ▼                   ▼
             ┌───────────┐       ┌──────────┐    ┌────────────────────┐
             │ completed │       │  failed  │    │needs_reconciliation│
             └───────────┘       └──────────┘    └────────────────────┘
                                      │                   │
                                 Can retry:          Must reconcile:
                                 DELETE failed,      query Shopify by
                                 INSERT new pending   metafield before
                                                     retry or manual
                                                     resolution
```

**Concurrent Request Handling:**

1. Request A arrives: `BEGIN IMMEDIATE` transaction → `INSERT INTO import_attempts (status='pending')` → `COMMIT`.
2. Request B arrives for same product: `INSERT` fails due to existing non-failed row → returns `409 IMPORT_IN_PROGRESS` or `409 DUPLICATE_PRODUCT` (if completed).
3. Request A completes Shopify call → `UPDATE status='completed'`.
4. If Request A times out → `UPDATE status='needs_reconciliation'`.
5. On retry after `needs_reconciliation`: query Shopify for products with the source metafield. If found, update to `completed`. If not found, delete the stale attempt and allow a new `pending` reservation.

**Stale Pending Cleanup:**

- A `pending` record older than 5 minutes is considered stale (Shopify mutation timeout is 30s + retries).
- On duplicate check, if a `pending` record is older than 5 minutes, treat it as `needs_reconciliation`.

## 3. Data Ownership

| Data | Owner | Lifetime |
|------|-------|----------|
| Shopify access token | Backend server (encrypted) | Until store disconnects or token revoked |
| Import attempt records | Backend server | Indefinite (until manually cleared) |
| Store metadata + currency | Backend server (cached from Shopify) | Until store disconnects; refreshable |
| Product data | Shopify (after import) | Managed in Shopify Admin |
| Source product data | AliExpress page | Transient — extracted, validated, sent, not stored beyond attempt record |

## 4. Token Storage Security

- Access tokens are encrypted using **AES-256-GCM** before storage.
- The encryption key (`ENCRYPTION_KEY`) is a 32-byte hex string stored in `.env`.
- Each token has a unique initialization vector (IV) for encryption.
- The authentication tag (auth_tag) ensures tamper detection.
- Decryption happens in-memory only when making Shopify API calls.
- The encryption key is **never** committed to version control.
- **Token type:** Shopify offline access tokens are long-lived and do not expire. They can only be revoked by uninstalling the app or rotating credentials. No refresh token is needed.
- **Revocation detection:** If Shopify returns HTTP 401 for a stored token, the backend marks the store as needing reauthorization and returns 401 to the extension.

## 5. Data Retention and Operations

- **Import attempt records** are retained indefinitely to prevent duplicate imports even after extended time periods.
- **Store records** are retained until the user explicitly disconnects. Deactivated stores (`is_active = 0`) retain their records but their tokens should be securely deleted.
- **Token deletion on disconnect:** When a store is disconnected, overwrite the encrypted token fields with zeros before deletion.
- **No automatic purging** — the data volume is negligible for single-store use.
- The entire database is a single file configurable via `DATABASE_PATH`.

### Backup and Restore

- **Backup:** Copy the `.db` file while the server is stopped, or use SQLite's `.backup` command.
- **Restore:** Stop the server, replace the `.db` file with the backup, restart.
- **Backup cadence:** Before any schema migration. Regular backups are optional for a single-store tool.
- **Verify restore:** After restoring, run `PRAGMA integrity_check;` and verify `GET /api/status` returns the correct store.

### File Permissions

- Database file: readable/writable only by the server process user (`chmod 600` on Linux).
- Database directory: not publicly accessible via web server.

## 6. Migration Strategy

- Migrations are simple versioned SQL scripts in `server/src/db/migrations/`.
- A `schema_version` table tracks the current version.
- Migrations run automatically on server startup.
- Initial migration (v1) creates both tables.

```sql
-- Migration v1: Initial schema
-- File: server/src/db/migrations/001_initial.sql

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stores (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_domain     TEXT    NOT NULL UNIQUE,
    access_token    TEXT    NOT NULL,
    token_iv        TEXT    NOT NULL,
    token_auth_tag  TEXT    NOT NULL,
    token_type      TEXT    NOT NULL DEFAULT 'offline',
    token_granted_at TEXT   NOT NULL DEFAULT (datetime('now')),
    scope           TEXT    NOT NULL,
    scopes_granted  TEXT    NOT NULL,
    store_name      TEXT,
    store_currency  TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_attempts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id            INTEGER NOT NULL REFERENCES stores(id),
    source_product_id   TEXT    NOT NULL,
    source_url          TEXT    NOT NULL,
    status              TEXT    NOT NULL DEFAULT 'pending',
    shopify_product_id  TEXT,
    shopify_admin_url   TEXT,
    product_title       TEXT    NOT NULL,
    source_currency     TEXT    NOT NULL,
    markup_percentage   REAL    NOT NULL,
    images_requested    INTEGER NOT NULL DEFAULT 0,
    images_succeeded    INTEGER,
    error_message       TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_source
    ON import_attempts(store_id, source_product_id, status);

INSERT INTO schema_version (version) VALUES (1);
```

## 7. Database File Location

- **Development:** `server/data/importer.db`
- **Production:** Configurable via `DATABASE_PATH` environment variable. Must be on a persistent volume.
- **`.gitignore`:** The `server/data/` directory and all `.db` files must be excluded from version control.

## 8. Logging

- Database operations log at `info` level: store connected/disconnected, import attempt created/completed/failed.
- **Never log:** access tokens (encrypted or plaintext), encryption keys, full JWT values.
- Log import attempt IDs for traceability.
- Use structured JSON logging in production.
