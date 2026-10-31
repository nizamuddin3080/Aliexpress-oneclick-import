import {
  getImportAttempt,
  reserveImportAttempt,
  updateImportAttempt,
  deleteImportAttempt,
  parseUtcDate,
  ReservationError,
  type ImportAttemptRecord,
} from '../db/database.js';
import type { AuthenticatedStore } from '../auth/middleware.js';
import {
  validateImportPayload,
  type ImportRequestBody,
  type ValidationErrorField,
} from '../validation/import-validator.js';
import { executeShopifyGraphQL, ShopifyClientError } from '../shopify/client.js';
import {
  PRODUCT_SET_MUTATION,
  buildProductSetPayload,
} from '../shopify/mutations/product-set.js';
import { findProductBySourceId } from '../shopify/queries/find-by-source.js';

export interface ImportSuccessResult {
  success: true;
  outcome: 'completed' | 'completed_partial_images';
  import_attempt_id: number;
  shopify_product_id: string;
  shopify_admin_url: string;
  title: string;
  variants_created: number;
  images_requested: number;
  images_succeeded: number;
  images_failed: number;
  currency: string;
  retryable: false;
  warnings?: string[];
}

export interface ImportStatusResponse {
  status: 'not_imported' | 'completed' | 'pending' | 'needs_reconciliation';
  shopify_product_id?: string;
  shopify_admin_url?: string;
  product_title?: string;
  imported_at?: string;
  message?: string;
}

export class ImportHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: ValidationErrorField[];
  readonly retryable: boolean;
  readonly shopifyAdminUrl?: string | null;
  readonly retryAfterSeconds?: number;
  readonly attemptId?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: {
      fields?: ValidationErrorField[];
      retryable?: boolean;
      shopifyAdminUrl?: string | null;
      retryAfterSeconds?: number;
      attemptId?: number;
    }
  ) {
    super(message);
    this.name = 'ImportHttpError';
    this.status = status;
    this.code = code;
    this.fields = options?.fields;
    this.retryable = options?.retryable ?? false;
    this.shopifyAdminUrl = options?.shopifyAdminUrl ?? null;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.attemptId = options?.attemptId;
  }
}

/**
 * Extracts the store handle from a myshopify domain (e.g. "my-shop.myshopify.com" -> "my-shop").
 */
export function getStoreHandle(shopDomain: string): string {
  return shopDomain.replace(/\.myshopify\.com$/i, '');
}

/**
 * Constructs the Shopify Admin product URL for a given product GID.
 */
export function buildShopifyAdminProductUrl(shopDomain: string, productGid: string): string {
  const handle = getStoreHandle(shopDomain);
  const numericId = productGid.split('/').pop() || '';
  return `https://admin.shopify.com/store/${handle}/products/${numericId}`;
}

/**
 * Constructs the Shopify Admin products list URL for fallback manual checks.
 */
export function buildShopifyAdminProductsUrl(shopDomain: string): string {
  const handle = getStoreHandle(shopDomain);
  return `https://admin.shopify.com/store/${handle}/products`;
}

/**
 * Verifies if a product previously imported into Shopify still exists in the merchant's store.
 * If the merchant deleted the product in Shopify Admin, returns null so the stale record can be cleared.
 * Returns undefined if verification is indeterminate (e.g. mock fetch or network failure).
 */
export async function verifyProductExistsInShopify(
  store: AuthenticatedStore,
  attempt: ImportAttemptRecord
): Promise<{ id: string; title: string; status: string } | null | undefined> {
  // 1. Direct GID node check (instant, does not wait for search indexing)
  if (attempt.shopify_product_id) {
    try {
      const response = await executeShopifyGraphQL<{ node?: { id: string; title: string; status: string } | null }>({
        shopDomain: store.shopDomain,
        accessToken: store.accessToken,
        query: `
          query CheckProductNode($id: ID!) {
            node(id: $id) {
              ... on Product {
                id
                title
                status
              }
            }
          }
        `,
        variables: { id: attempt.shopify_product_id },
        timeoutMs: 8_000,
      });

      if (response.data && typeof response.data === 'object' && 'node' in response.data) {
        if (response.data.node === null) {
          return null; // Confirmed deleted in Shopify
        }
        if (response.data.node?.id) {
          return response.data.node; // Confirmed still exists
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  // 2. If no GID was recorded, attempt metafield search
  try {
    const existing = await findProductBySourceId(store.shopDomain, store.accessToken, attempt.source_product_id);
    if (existing) return existing;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks the status of an import for a given AliExpress product ID.
 * Automatically reconciles any uncertain outcome, stale pending record, or deleted Shopify product.
 */
export async function checkImportStatus(
  store: AuthenticatedStore,
  sourceProductId: string
): Promise<ImportStatusResponse> {
  const attempt = getImportAttempt(store.id, sourceProductId);

  if (!attempt) {
    return { status: 'not_imported' };
  }

  // 1. Completed state: verify if product still exists in Shopify
  if (attempt.status === 'completed' || attempt.status === 'completed_partial_images') {
    try {
      const existingInShopify = await verifyProductExistsInShopify(store, attempt);
      if (existingInShopify === null) {
        // Merchant definitively deleted the product in Shopify Admin! Clean up stale record to allow fresh re-import.
        deleteImportAttempt(attempt.id);
        return { status: 'not_imported' };
      }

      if (existingInShopify) {
        return {
          status: 'completed',
          shopify_product_id: existingInShopify.id,
          shopify_admin_url: buildShopifyAdminProductUrl(store.shopDomain, existingInShopify.id),
          product_title: existingInShopify.title,
          imported_at: attempt.updated_at,
        };
      }
    } catch {
      // Fall through to existing DB record
    }

    return {
      status: 'completed',
      shopify_product_id: attempt.shopify_product_id || undefined,
      shopify_admin_url: attempt.shopify_admin_url || undefined,
      product_title: attempt.product_title,
      imported_at: attempt.updated_at,
    };
  }

  // 2. Pending state
  if (attempt.status === 'pending') {
    const createdAt = parseUtcDate(attempt.created_at);
    const elapsedMinutes = (Date.now() - createdAt) / (1000 * 60);

    if (elapsedMinutes < 5) {
      return {
        status: 'pending',
        message: 'An import is already in progress for this product.',
      };
    }

    // Stale pending (> 5 min): auto-reconcile with Shopify
    return reconcileWithShopify(store, attempt);
  }

  // 3. Needs reconciliation state
  if (attempt.status === 'needs_reconciliation') {
    return reconcileWithShopify(store, attempt);
  }

  // 4. Failed state: safe to re-import
  return { status: 'not_imported' };
}

/**
 * Queries Shopify to reconcile an ambiguous import outcome.
 */
async function reconcileWithShopify(
  store: AuthenticatedStore,
  attempt: ImportAttemptRecord
): Promise<ImportStatusResponse> {
  try {
    const existingInShopify = await findProductBySourceId(
      store.shopDomain,
      store.accessToken,
      attempt.source_product_id
    );

    if (existingInShopify) {
      const adminUrl = buildShopifyAdminProductUrl(store.shopDomain, existingInShopify.id);
      updateImportAttempt(attempt.id, {
        status: 'completed',
        shopifyProductId: existingInShopify.id,
        shopifyAdminUrl: adminUrl,
      });

      return {
        status: 'completed',
        shopify_product_id: existingInShopify.id,
        shopify_admin_url: adminUrl,
        product_title: existingInShopify.title,
        imported_at: attempt.updated_at,
      };
    }

    // Product does not exist in Shopify. Safe to clear the attempt.
    deleteImportAttempt(attempt.id);
    return { status: 'not_imported' };
  } catch {
    // If reconciliation query fails, report needs_reconciliation
    return {
      status: 'needs_reconciliation',
      message:
        'A previous import attempt for this product had an uncertain outcome. The system could not reach Shopify to reconcile.',
      shopify_admin_url: buildShopifyAdminProductsUrl(store.shopDomain),
    };
  }
}

interface GraphQLProductSetData {
  productSet?: {
    product?: {
      id: string;
      title: string;
      handle: string;
      status: string;
      media?: {
        nodes: Array<{
          id: string;
          status: string;
        }>;
      };
    };
    userErrors?: Array<{
      field: string[];
      message: string;
      code: string;
    }>;
  };
}

/**
 * Executes a single-product import into the authenticated Shopify store.
 * Strictly guarantees:
 * - DRAFT status on Shopify.
 * - Idempotent reservation to prevent concurrent and duplicate imports.
 * - Ambiguous timeout handling marking needs_reconciliation.
 * - Decimal-safe pricing markup.
 */
export async function executeImport(
  store: AuthenticatedStore,
  payload: unknown
): Promise<ImportSuccessResult> {
  // 1. Server-side payload validation
  const validation = validateImportPayload(payload, store.storeCurrency);
  if (!validation.isValid) {
    if (validation.errorCode === 'CURRENCY_MISMATCH') {
      throw new ImportHttpError(400, 'CURRENCY_MISMATCH', validation.errorMessage || 'Currency mismatch', {
        fields: validation.fields,
        retryable: true,
      });
    }
    if (validation.errorCode === 'UNSUPPORTED_PRODUCT') {
      throw new ImportHttpError(400, 'UNSUPPORTED_PRODUCT', validation.errorMessage || 'Unsupported product', {
        fields: validation.fields,
        retryable: false,
      });
    }
    throw new ImportHttpError(400, 'VALIDATION_ERROR', validation.errorMessage || 'Validation error', {
      fields: validation.fields,
      retryable: true,
    });
  }

  const data = payload as ImportRequestBody;

  // If force_reimport is requested, clear any previous import attempt record
  if (data.force_reimport) {
    const existingAttempt = getImportAttempt(store.id, data.source_product_id);
    if (existingAttempt) {
      deleteImportAttempt(existingAttempt.id);
    }
  }

  // 2. Pre-check / Reconciliation
  const statusCheck = await checkImportStatus(store, data.source_product_id);
  if (statusCheck.status === 'completed') {
    throw new ImportHttpError(
      409,
      'DUPLICATE_PRODUCT',
      `Product "${statusCheck.product_title || data.title}" has already been imported into this store.`,
      {
        retryable: false,
        shopifyAdminUrl: statusCheck.shopify_admin_url,
      }
    );
  }
  if (statusCheck.status === 'pending') {
    throw new ImportHttpError(
      409,
      'IMPORT_IN_PROGRESS',
      'An import is currently in progress for this product. Please wait.',
      {
        retryable: false,
      }
    );
  }
  if (statusCheck.status === 'needs_reconciliation') {
    throw new ImportHttpError(
      409,
      'NEEDS_RECONCILIATION',
      'A previous import attempt had an uncertain outcome. Please verify your Shopify Admin before re-attempting.',
      {
        retryable: false,
        shopifyAdminUrl: statusCheck.shopify_admin_url,
      }
    );
  }

  // 3. Reserve import attempt (BEGIN IMMEDIATE)
  let attempt: ImportAttemptRecord;
  try {
    attempt = reserveImportAttempt({
      storeId: store.id,
      sourceProductId: data.source_product_id,
      sourceUrl: data.source_url,
      productTitle: data.title,
      sourceCurrency: data.source_currency,
      markupPercentage: data.markup_percentage,
      imagesRequested: data.images?.length || 0,
    });
  } catch (err) {
    if (err instanceof ReservationError) {
      if (err.code === 'DUPLICATE_PRODUCT') {
        throw new ImportHttpError(409, 'DUPLICATE_PRODUCT', err.message, {
          retryable: false,
          shopifyAdminUrl: err.existingAttempt.shopify_admin_url,
        });
      }
      if (err.code === 'IMPORT_IN_PROGRESS') {
        throw new ImportHttpError(409, 'IMPORT_IN_PROGRESS', err.message, { retryable: false });
      }
      throw new ImportHttpError(409, 'NEEDS_RECONCILIATION', err.message, {
        retryable: false,
        shopifyAdminUrl: buildShopifyAdminProductsUrl(store.shopDomain),
      });
    }
    throw err;
  }

  // 4. Build mutation variables
  const variables = buildProductSetPayload(data);

  // 5. Send mutation to Shopify Admin GraphQL
  let response: { data?: GraphQLProductSetData };
  try {
    response = await executeShopifyGraphQL<GraphQLProductSetData>({
      shopDomain: store.shopDomain,
      accessToken: store.accessToken,
      query: PRODUCT_SET_MUTATION,
      variables: variables as unknown as Record<string, unknown>,
      timeoutMs: 30_000,
    });
  } catch (err: unknown) {
    if (err instanceof ShopifyClientError) {
      if (err.code === 'TIMEOUT') {
        // Mutation sent but timed out — outcome is UNCERTAIN!
        updateImportAttempt(attempt.id, {
          status: 'needs_reconciliation',
          errorMessage: 'Request to Shopify Admin API timed out after 30 seconds.',
        });

        throw new ImportHttpError(
          502,
          'UNKNOWN_OUTCOME',
          'The import request was sent to Shopify, but we could not confirm the result within 30 seconds. Do not retry immediately — please check your Shopify Admin.',
          {
            retryable: false,
            shopifyAdminUrl: buildShopifyAdminProductsUrl(store.shopDomain),
            attemptId: attempt.id,
          }
        );
      }

      if (err.code === 'RATE_LIMITED') {
        updateImportAttempt(attempt.id, {
          status: 'failed',
          errorMessage: err.message,
        });
        throw new ImportHttpError(429, 'RATE_LIMITED', err.message, {
          retryable: true,
          retryAfterSeconds: err.retryAfterSeconds || 2,
          attemptId: attempt.id,
        });
      }

      if (err.code === 'UNAUTHORIZED') {
        updateImportAttempt(attempt.id, {
          status: 'failed',
          errorMessage: err.message,
        });
        throw new ImportHttpError(401, 'REAUTHORIZATION_REQUIRED', err.message, {
          retryable: false,
          attemptId: attempt.id,
        });
      }
    }

    // Transport error or unexpected failure before completing
    updateImportAttempt(attempt.id, {
      status: 'failed',
      errorMessage: (err as Error).message,
    });

    throw new ImportHttpError(
      502,
      'SHOPIFY_API_ERROR',
      `Error communicating with Shopify: ${(err as Error).message}`,
      {
        retryable: true,
        attemptId: attempt.id,
      }
    );
  }

  // 6. Inspect GraphQL User Errors
  const userErrors = response.data?.productSet?.userErrors;
  if (userErrors && userErrors.length > 0) {
    const errorDetails = userErrors.map(e => ({
      field: Array.isArray(e.field) ? e.field.join('.') : String(e.field || 'input'),
      message: e.message,
    }));
    const message = userErrors.map(e => e.message).join('; ');

    updateImportAttempt(attempt.id, {
      status: 'failed',
      errorMessage: message,
    });

    throw new ImportHttpError(422, 'SHOPIFY_VALIDATION_ERROR', `Shopify rejected product data: ${message}`, {
      fields: errorDetails,
      retryable: true,
      attemptId: attempt.id,
    });
  }

  // 7. Verify Product was created
  const createdProduct = response.data?.productSet?.product;
  if (!createdProduct || !createdProduct.id) {
    const errorDetail = (response as { errors?: Array<{ message: string }> }).errors?.map(e => e.message).join('; ')
      || 'Shopify product creation did not return a valid product ID.';
    updateImportAttempt(attempt.id, {
      status: 'failed',
      errorMessage: errorDetail,
    });
    throw new ImportHttpError(
      502,
      'SHOPIFY_API_ERROR',
      errorDetail,
      { retryable: true, attemptId: attempt.id }
    );
  }

  // 8. Image Accounting & URL generation
  const adminUrl = buildShopifyAdminProductUrl(store.shopDomain, createdProduct.id);
  const imagesRequested = data.images?.length || 0;

  // Inspect media returned by Shopify
  const mediaNodes = createdProduct.media?.nodes || [];
  let imagesSucceeded = 0;
  let imagesFailed = 0;

  if (imagesRequested > 0) {
    imagesSucceeded = mediaNodes.filter(m => m.status !== 'FAILED').length;
    // If Shopify returned fewer media items than requested, count the delta as failed
    if (imagesSucceeded > imagesRequested) {
      imagesSucceeded = imagesRequested;
    }
    imagesFailed = Math.max(0, imagesRequested - imagesSucceeded);
  }

  const isPartialImages = imagesFailed > 0;
  const finalStatus = isPartialImages ? 'completed_partial_images' : 'completed';

  updateImportAttempt(attempt.id, {
    status: finalStatus,
    shopifyProductId: createdProduct.id,
    shopifyAdminUrl: adminUrl,
    imagesSucceeded,
  });

  const result: ImportSuccessResult = {
    success: true,
    outcome: finalStatus,
    import_attempt_id: attempt.id,
    shopify_product_id: createdProduct.id,
    shopify_admin_url: adminUrl,
    title: createdProduct.title || data.title,
    variants_created: data.variants.length,
    images_requested: imagesRequested,
    images_succeeded: imagesSucceeded,
    images_failed: imagesFailed,
    currency: store.storeCurrency || data.source_currency,
    retryable: false,
  };

  if (isPartialImages) {
    result.warnings = [
      `${imagesFailed} of ${imagesRequested} images could not be uploaded. You can add them manually in Shopify.`,
    ];
  }

  return result;
}
