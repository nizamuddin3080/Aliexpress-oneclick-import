import { type Request, type Response, type NextFunction } from 'express';
import { verifyJwt } from './jwt.js';
import { getDatabase, type StoreRecord } from '../db/database.js';
import { decryptToken } from './crypto.js';

export interface AuthenticatedStore {
  id: number;
  shopDomain: string;
  storeName: string | null;
  storeCurrency: string | null;
  accessToken: string;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      store?: AuthenticatedStore;
    }
  }
}

/**
 * Express middleware to validate JWT on protected /api/* endpoints.
 */
export function requireStoreAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: {
        code: 'MISSING_TOKEN',
        message: 'Authorization header with Bearer token is required.',
      },
    });
    return;
  }

  const token = authHeader.split(' ')[1]?.trim();
  if (!token) {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Empty or malformed Bearer token.',
      },
    });
    return;
  }

  try {
    const payload = verifyJwt(token);

    // Verify store exists and is currently active in the SQLite database
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM stores WHERE id = ? AND is_active = 1 LIMIT 1');
    const store = stmt.get(payload.storeId) as unknown as StoreRecord | undefined;

    if (!store || store.shop_domain !== payload.storeDomain) {
      res.status(401).json({
        success: false,
        error: {
          code: 'STORE_NOT_FOUND',
          message: 'The authenticated store session is no longer active. Please reconnect.',
        },
      });
      return;
    }

    // Decrypt access token for internal use
    let accessToken: string;
    try {
      accessToken = decryptToken(store.access_token, store.token_iv, store.token_auth_tag);
    } catch {
      res.status(401).json({
        success: false,
        error: {
          code: 'REAUTHORIZATION_REQUIRED',
          message: 'Could not decrypt stored credentials. Reauthorization required.',
        },
      });
      return;
    }

    req.store = {
      id: store.id,
      shopDomain: store.shop_domain,
      storeName: store.store_name,
      storeCurrency: store.store_currency,
      accessToken,
    };

    next();
  } catch (err: unknown) {
    const message = (err as Error).message || '';
    if (message.includes('jwt expired')) {
      res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Your store session has expired. Please reconnect.',
        },
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authorization token.',
      },
    });
  }
}
