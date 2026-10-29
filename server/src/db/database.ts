import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface StoreRecord {
  id: number;
  shop_domain: string;
  access_token: string;
  token_iv: string;
  token_auth_tag: string;
  token_type: string;
  token_granted_at: string;
  scope: string;
  scopes_granted: string;
  store_name: string | null;
  store_currency: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ImportAttemptRecord {
  id: number;
  store_id: number;
  source_product_id: string;
  source_url: string;
  status: 'pending' | 'completed' | 'completed_partial_images' | 'failed' | 'needs_reconciliation';
  shopify_product_id: string | null;
  shopify_admin_url: string | null;
  product_title: string;
  source_currency: string;
  markup_percentage: number;
  images_requested: number;
  images_succeeded: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

let dbInstance: DatabaseSync | null = null;

/**
 * Initializes the SQLite database, configures pragmas, and executes migrations.
 * @param dbPath Path to SQLite file or ':memory:'
 */
export function initDatabase(dbPath = ':memory:'): DatabaseSync {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  // Configure pragmas
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  // Schema initialization
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stores (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_domain      TEXT    NOT NULL UNIQUE,
      access_token     TEXT    NOT NULL,
      token_iv         TEXT    NOT NULL,
      token_auth_tag   TEXT    NOT NULL,
      token_type       TEXT    NOT NULL DEFAULT 'offline',
      token_granted_at TEXT   NOT NULL DEFAULT (datetime('now')),
      scope            TEXT    NOT NULL,
      scopes_granted   TEXT    NOT NULL,
      store_name       TEXT,
      store_currency   TEXT,
      is_active        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
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
  `);

  dbInstance = db;
  return db;
}

/**
 * Returns the current database instance, initializing it with default path if needed.
 */
export function getDatabase(): DatabaseSync {
  if (!dbInstance) {
    const defaultPath = process.env.DATABASE_PATH || path.resolve('data/importer.db');
    return initDatabase(defaultPath);
  }
  return dbInstance;
}

/**
 * Closes the active database connection.
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Fetches the currently active store record.
 */
export function getActiveStore(db = getDatabase()): StoreRecord | null {
  const stmt = db.prepare('SELECT * FROM stores WHERE is_active = 1 LIMIT 1');
  const row = stmt.get() as unknown as StoreRecord | undefined;
  return row || null;
}

/**
 * Fetches a store record by shop domain.
 */
export function getStoreByDomain(shopDomain: string, db = getDatabase()): StoreRecord | null {
  const stmt = db.prepare('SELECT * FROM stores WHERE shop_domain = ? LIMIT 1');
  const row = stmt.get(shopDomain) as unknown as StoreRecord | undefined;
  return row || null;
}

export interface SaveStoreParams {
  shopDomain: string;
  accessTokenEncrypted: string;
  tokenIv: string;
  tokenAuthTag: string;
  scope: string;
  scopesGranted: string;
  storeName: string | null;
  storeCurrency: string | null;
}

/**
 * Saves a store record, activating it and ensuring single active store enforcement.
 */
export function saveActiveStore(params: SaveStoreParams, db = getDatabase()): StoreRecord {
  // 1. Deactivate any existing active stores to enforce single-store active rule
  db.exec('UPDATE stores SET is_active = 0 WHERE is_active = 1;');

  // 2. Check if this shop_domain was previously saved
  const existing = getStoreByDomain(params.shopDomain, db);

  if (existing) {
    const updateStmt = db.prepare(`
      UPDATE stores SET
        access_token = ?,
        token_iv = ?,
        token_auth_tag = ?,
        token_type = 'offline',
        token_granted_at = datetime('now'),
        scope = ?,
        scopes_granted = ?,
        store_name = ?,
        store_currency = ?,
        is_active = 1,
        updated_at = datetime('now')
      WHERE id = ?
    `);

    updateStmt.run(
      params.accessTokenEncrypted,
      params.tokenIv,
      params.tokenAuthTag,
      params.scope,
      params.scopesGranted,
      params.storeName,
      params.storeCurrency,
      existing.id
    );

    return getStoreByDomain(params.shopDomain, db)!;
  }

  // 3. Insert new active store record
  const insertStmt = db.prepare(`
    INSERT INTO stores (
      shop_domain,
      access_token,
      token_iv,
      token_auth_tag,
      token_type,
      token_granted_at,
      scope,
      scopes_granted,
      store_name,
      store_currency,
      is_active
    ) VALUES (?, ?, ?, ?, 'offline', datetime('now'), ?, ?, ?, ?, 1)
  `);

  insertStmt.run(
    params.shopDomain,
    params.accessTokenEncrypted,
    params.tokenIv,
    params.tokenAuthTag,
    params.scope,
    params.scopesGranted,
    params.storeName,
    params.storeCurrency
  );

  return getStoreByDomain(params.shopDomain, db)!;
}

/**
 * Disconnects an active store: securely wipes encrypted token fields with zeroes before deactivating.
 */
export function wipeAndDisconnectStore(shopDomain: string, db = getDatabase()): boolean {
  const store = getStoreByDomain(shopDomain, db);
  if (!store) {
    return false;
  }

  // Overwrite token fields with zeroes (zero-fill wipe)
  const zeroToken = '0'.repeat(store.access_token.length);
  const zeroIv = '0'.repeat(store.token_iv.length);
  const zeroTag = '0'.repeat(store.token_auth_tag.length);

  const stmt = db.prepare(`
    UPDATE stores SET
      access_token = ?,
      token_iv = ?,
      token_auth_tag = ?,
      is_active = 0,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  stmt.run(zeroToken, zeroIv, zeroTag, store.id);
  return true;
}

export interface ReserveAttemptParams {
  storeId: number;
  sourceProductId: string;
  sourceUrl: string;
  productTitle: string;
  sourceCurrency: string;
  markupPercentage: number;
  imagesRequested: number;
}

export type ReservationErrorCode =
  | 'DUPLICATE_PRODUCT'
  | 'IMPORT_IN_PROGRESS'
  | 'NEEDS_RECONCILIATION'
  | 'STALE_PENDING';

export class ReservationError extends Error {
  readonly code: ReservationErrorCode;
  readonly existingAttempt: ImportAttemptRecord;

  constructor(code: ReservationErrorCode, message: string, existingAttempt: ImportAttemptRecord) {
    super(message);
    this.name = 'ReservationError';
    this.code = code;
    this.existingAttempt = existingAttempt;
  }
}

/**
 * Fetches the latest import attempt for a given store and AliExpress product ID.
 */
export function getImportAttempt(
  storeId: number,
  sourceProductId: string,
  db = getDatabase()
): ImportAttemptRecord | null {
  const stmt = db.prepare(
    'SELECT * FROM import_attempts WHERE store_id = ? AND source_product_id = ? ORDER BY id DESC LIMIT 1'
  );
  const row = stmt.get(storeId, sourceProductId) as unknown as ImportAttemptRecord | undefined;
  return row || null;
}

/**
 * Safely parses a SQLite datetime string into UTC epoch milliseconds.
 * SQLite datetime('now') produces 'YYYY-MM-DD HH:MM:SS' without timezone.
 */
export function parseUtcDate(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  if (dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr).getTime();
  }
  const isoStr = dateStr.replace(' ', 'T') + 'Z';
  return new Date(isoStr).getTime();
}

/**
 * Reserves an import attempt using SQLite BEGIN IMMEDIATE for concurrency control.
 * Prevents race conditions and duplicate creation attempts.
 */
export function reserveImportAttempt(
  params: ReserveAttemptParams,
  db = getDatabase()
): ImportAttemptRecord {
  // Use BEGIN IMMEDIATE to serialize concurrent write transactions
  db.exec('BEGIN IMMEDIATE;');

  try {
    const checkStmt = db.prepare(
      'SELECT * FROM import_attempts WHERE store_id = ? AND source_product_id = ? ORDER BY id DESC LIMIT 1'
    );
    const existing = checkStmt.get(params.storeId, params.sourceProductId) as unknown as
      | ImportAttemptRecord
      | undefined;

    if (existing) {
      if (existing.status === 'completed' || existing.status === 'completed_partial_images') {
        throw new ReservationError(
          'DUPLICATE_PRODUCT',
          `Product has already been imported (Shopify Product: ${existing.shopify_product_id}).`,
          existing
        );
      }

      if (existing.status === 'pending') {
        const createdAt = parseUtcDate(existing.created_at);
        const now = Date.now();
        const elapsedMinutes = (now - createdAt) / (1000 * 60);

        if (elapsedMinutes < 5) {
          throw new ReservationError(
            'IMPORT_IN_PROGRESS',
            'An import is currently in progress for this product.',
            existing
          );
        } else {
          // Stale pending (> 5 minutes). Update to needs_reconciliation
          db.prepare("UPDATE import_attempts SET status = 'needs_reconciliation', updated_at = datetime('now') WHERE id = ?")
            .run(existing.id);
          const updated = checkStmt.get(params.storeId, params.sourceProductId) as unknown as ImportAttemptRecord;
          throw new ReservationError(
            'NEEDS_RECONCILIATION',
            'A previous import attempt timed out or did not finish cleanly. Reconciliation required.',
            updated
          );
        }
      }

      if (existing.status === 'needs_reconciliation') {
        throw new ReservationError(
          'NEEDS_RECONCILIATION',
          'A previous import attempt had an uncertain outcome. Reconciliation required before retry.',
          existing
        );
      }

      if (existing.status === 'failed') {
        // Safe to clear failed attempt before starting a new reservation
        db.prepare('DELETE FROM import_attempts WHERE id = ?').run(existing.id);
      }
    }

    const insertStmt = db.prepare(`
      INSERT INTO import_attempts (
        store_id,
        source_product_id,
        source_url,
        status,
        product_title,
        source_currency,
        markup_percentage,
        images_requested
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
    `);

    insertStmt.run(
      params.storeId,
      params.sourceProductId,
      params.sourceUrl,
      params.productTitle,
      params.sourceCurrency,
      params.markupPercentage,
      params.imagesRequested
    );

    const created = checkStmt.get(params.storeId, params.sourceProductId) as unknown as ImportAttemptRecord;
    db.exec('COMMIT;');
    return created;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export interface UpdateAttemptParams {
  status: 'pending' | 'completed' | 'completed_partial_images' | 'failed' | 'needs_reconciliation';
  shopifyProductId?: string | null;
  shopifyAdminUrl?: string | null;
  imagesSucceeded?: number | null;
  errorMessage?: string | null;
}

/**
 * Updates an import attempt record with the mutation outcome.
 */
export function updateImportAttempt(
  attemptId: number,
  updates: UpdateAttemptParams,
  db = getDatabase()
): ImportAttemptRecord {
  const stmt = db.prepare(`
    UPDATE import_attempts SET
      status = ?,
      shopify_product_id = COALESCE(?, shopify_product_id),
      shopify_admin_url = COALESCE(?, shopify_admin_url),
      images_succeeded = COALESCE(?, images_succeeded),
      error_message = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  stmt.run(
    updates.status,
    updates.shopifyProductId ?? null,
    updates.shopifyAdminUrl ?? null,
    updates.imagesSucceeded ?? null,
    updates.errorMessage ?? null,
    attemptId
  );

  const fetchStmt = db.prepare('SELECT * FROM import_attempts WHERE id = ? LIMIT 1');
  const record = fetchStmt.get(attemptId) as unknown as ImportAttemptRecord | undefined;
  if (!record) {
    throw new Error(`Import attempt with ID ${attemptId} not found.`);
  }
  return record;
}

/**
 * Deletes an import attempt (e.g. after reconciling that a product was NOT created in Shopify).
 */
export function deleteImportAttempt(attemptId: number, db = getDatabase()): void {
  const stmt = db.prepare('DELETE FROM import_attempts WHERE id = ?');
  stmt.run(attemptId);
}
