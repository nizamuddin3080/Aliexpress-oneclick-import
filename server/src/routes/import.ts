import { Router, type Request, type Response } from 'express';
import { requireStoreAuth } from '../auth/middleware.js';
import {
  checkImportStatus,
  executeImport,
  ImportHttpError,
} from '../services/import-service.js';

export const importRouter = Router();

/**
 * GET /api/import/:sourceProductId
 * Returns the current import status for the requested AliExpress product ID.
 */
importRouter.get(
  '/api/import/:sourceProductId',
  requireStoreAuth,
  async (req: Request, res: Response) => {
    try {
      const rawSourceId = req.params.sourceProductId;
      const sourceProductId = Array.isArray(rawSourceId) ? rawSourceId[0] : rawSourceId;
      if (!sourceProductId || !/^\d+$/.test(sourceProductId)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PRODUCT_ID',
            message: 'sourceProductId must be a numeric AliExpress product ID.',
          },
        });
        return;
      }

      const status = await checkImportStatus(req.store!, sourceProductId);
      res.status(200).json(status);
    } catch (err: unknown) {
      res.status(500).json({
        success: false,
        error: {
          code: 'STATUS_CHECK_FAILED',
          message: (err as Error).message,
        },
      });
    }
  }
);

/**
 * POST /api/import
 * Imports a single AliExpress product as a Draft in the authenticated Shopify store.
 */
importRouter.post('/api/import', requireStoreAuth, async (req: Request, res: Response) => {
  try {
    const result = await executeImport(req.store!, req.body);
    res.status(201).json(result);
  } catch (err: unknown) {
    if (err instanceof ImportHttpError) {
      if (err.code === 'UNKNOWN_OUTCOME') {
        res.status(err.status).json({
          success: false,
          outcome: 'needs_reconciliation',
          import_attempt_id: err.attemptId,
          error: {
            code: err.code,
            message: err.message,
            retryable: false,
            shopify_admin_url: err.shopifyAdminUrl,
          },
        });
        return;
      }

      const errorPayload: Record<string, unknown> = {
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        shopify_admin_url: err.shopifyAdminUrl,
      };

      if (err.fields) {
        errorPayload.fields = err.fields;
      }

      if (err.retryAfterSeconds !== undefined) {
        errorPayload.retry_after_seconds = err.retryAfterSeconds;
      }

      res.status(err.status).json({
        success: false,
        outcome: 'failed',
        import_attempt_id: err.attemptId,
        error: errorPayload,
      });
      return;
    }

    // Unhandled exception
    res.status(500).json({
      success: false,
      outcome: 'failed',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: (err as Error).message || 'An unexpected error occurred during import.',
        retryable: true,
      },
    });
  }
});
