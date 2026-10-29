import { Router, type Request, type Response } from 'express';
import { config, checkAuthConfiguration } from '../config.js';
import {
  validateShopDomain,
  createStateNonce,
  verifyAndConsumeStateNonce,
  buildShopifyAuthUrl,
  verifyShopifyHmac,
  exchangeCodeForToken,
  fetchShopCurrencyAndName,
} from '../auth/oauth.js';
import { encryptToken } from '../auth/crypto.js';
import { saveActiveStore, getStoreByDomain, wipeAndDisconnectStore } from '../db/database.js';
import { generateSingleUseAuthCode, consumeSingleUseAuthCode, signJwt } from '../auth/jwt.js';
import { requireStoreAuth } from '../auth/middleware.js';

export const authRouter = Router();

/**
 * GET /auth/shopify
 * Initiates the Shopify OAuth flow for a given shop domain.
 */
authRouter.get('/auth/shopify', (req: Request, res: Response) => {
  const authStatus = checkAuthConfiguration();
  if (!authStatus.isConfigured) {
    res.status(503).json({
      success: false,
      error: {
        code: 'AUTH_NOT_CONFIGURED',
        message: authStatus.actionMessage,
      },
    });
    return;
  }

  const shop = req.query.shop as string | undefined;

  if (!shop || !validateShopDomain(shop)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_SHOP_DOMAIN',
        message: 'A valid Shopify store domain ending with .myshopify.com is required.',
      },
    });
    return;
  }

  const sanitizedShop = shop.trim().toLowerCase();
  const state = createStateNonce();
  const authUrl = buildShopifyAuthUrl(sanitizedShop, state);

  res.redirect(authUrl);
});

/**
 * GET /auth/shopify/callback
 * Handles OAuth callback from Shopify, validates HMAC, exchanges token, and redirects to extension.
 */
authRouter.get('/auth/shopify/callback', async (req: Request, res: Response) => {
  const query = req.query as Record<string, string | undefined>;
  const { code, shop, state } = query;

  // 1. Verify shop domain
  if (!shop || !validateShopDomain(shop)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_SHOP',
        message: 'Invalid or missing shop domain in OAuth callback.',
      },
    });
    return;
  }

  // 2. Verify and consume state nonce (CSRF protection, single-use)
  if (!state || !verifyAndConsumeStateNonce(state)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_STATE',
        message: 'CSRF state verification failed or state has expired.',
      },
    });
    return;
  }

  // 3. Verify HMAC signature using Shopify client secret
  const isHmacValid = verifyShopifyHmac(query, config.SHOPIFY_CLIENT_SECRET);
  if (!isHmacValid) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_HMAC',
        message: 'HMAC signature verification failed. Request may be tampered.',
      },
    });
    return;
  }

  // 4. Verify authorization code is present
  if (!code) {
    res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_CODE',
        message: 'Authorization code is missing from callback.',
      },
    });
    return;
  }

  try {
    const sanitizedShop = shop.trim().toLowerCase();

    // 5. Exchange code for offline access token
    const tokenResult = await exchangeCodeForToken(sanitizedShop, code);

    // 6. Query store details (name and base currency)
    const shopDetails = await fetchShopCurrencyAndName(sanitizedShop, tokenResult.accessToken);

    // 7. Encrypt access token at rest (AES-256-GCM)
    const encrypted = encryptToken(tokenResult.accessToken);

    // 8. Save active store in SQLite (enforces single-store active model)
    const storeRecord = saveActiveStore({
      shopDomain: sanitizedShop,
      accessTokenEncrypted: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      scope: config.SHOPIFY_SCOPES,
      scopesGranted: tokenResult.scope,
      storeName: shopDetails.name,
      storeCurrency: shopDetails.currencyCode,
    });

    // 9. Generate single-use authorization code (60-second TTL) for extension handoff
    const authCode = generateSingleUseAuthCode(storeRecord.id, storeRecord.shop_domain);

    // 10. Redirect to Chrome extension callback page
    if (config.EXTENSION_ID) {
      const extensionUrl = `chrome-extension://${config.EXTENSION_ID}/popup/auth-callback.html?code=${authCode}`;
      res.redirect(extensionUrl);
      return;
    }

    // Fallback if EXTENSION_ID is not configured in development
    res.status(200).send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2>Store Connected Successfully!</h2>
          <p>Connected store: <strong>${shopDetails.name} (${sanitizedShop})</strong></p>
          <p>Store Currency: <strong>${shopDetails.currencyCode}</strong></p>
          <p>Your single-use authorization code: <code>${authCode}</code></p>
          <p style="color: #666; font-size: 13px;">(Set EXTENSION_ID in server/.env to enable automatic redirect to the extension)</p>
        </body>
      </html>
    `);
  } catch (err: unknown) {
    console.error('[OAuth Callback Error]:', err);
    res.status(502).json({
      success: false,
      error: {
        code: 'TOKEN_EXCHANGE_FAILED',
        message: `Failed to complete Shopify connection: ${(err as Error).message}`,
      },
    });
  }
});

/**
 * POST /auth/exchange
 * Exchanges single-use authorization code for a 7-day bearer JWT.
 */
authRouter.post('/auth/exchange', (req: Request, res: Response) => {
  const { code } = req.body as { code?: string };

  if (!code) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_CODE',
        message: 'Authorization code is required.',
      },
    });
    return;
  }

  // Consume the single-use code
  const result = consumeSingleUseAuthCode(code);
  if (!result) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_CODE',
        message: 'Invalid, expired, or already consumed authorization code.',
      },
    });
    return;
  }

  const store = getStoreByDomain(result.shopDomain);
  if (!store || store.is_active !== 1) {
    res.status(401).json({
      success: false,
      error: {
        code: 'STORE_INACTIVE',
        message: 'The store associated with this code is not active.',
      },
    });
    return;
  }

  // Issue 7-day JWT containing minimal store identification
  const token = signJwt({
    storeId: store.id,
    storeDomain: store.shop_domain,
  });

  res.status(200).json({
    success: true,
    token,
    store_name: store.store_name,
    store_currency: store.store_currency,
    shop_domain: store.shop_domain,
  });
});

/**
 * GET /api/status
 * Returns connection status and cached currency of the active connected store.
 */
authRouter.get('/api/status', requireStoreAuth, (req: Request, res: Response) => {
  res.status(200).json({
    connected: true,
    shop_domain: req.store!.shopDomain,
    store_name: req.store!.storeName,
    store_currency: req.store!.storeCurrency,
  });
});

/**
 * POST /api/disconnect
 * Disconnects the active store and wipes encrypted credentials with zeroes.
 */
authRouter.post('/api/disconnect', requireStoreAuth, (req: Request, res: Response) => {
  const wiped = wipeAndDisconnectStore(req.store!.shopDomain);

  res.status(200).json({
    success: wiped,
    message: 'Store connection successfully removed and credentials wiped.',
  });
});
