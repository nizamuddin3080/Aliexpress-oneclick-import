import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  initDatabase,
  closeDatabase,
  getActiveStore,
  saveActiveStore,
  wipeAndDisconnectStore,
  getStoreByDomain,
} from '../src/db/database.js';
import { encryptToken, generateEncryptionKey } from '../src/auth/crypto.js';
import {
  generateSingleUseAuthCode,
  consumeSingleUseAuthCode,
  signJwt,
  verifyJwt,
} from '../src/auth/jwt.js';

describe('Auth Lifecycle, Database & Single-Store Enforcement (M2, AT-03..AT-05)', () => {
  const encryptionKey = generateEncryptionKey();
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    // Initialize fresh in-memory database for each test
    initDatabase(':memory:');
    process.env.ENCRYPTION_KEY = encryptionKey;
    process.env.SHOPIFY_CLIENT_ID = 'test_client_id';
    process.env.SHOPIFY_CLIENT_SECRET = 'test_client_secret';
    app = createApp();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('Database Store Operations & Single-Store Policy (AT-05)', () => {
    it('saves a store and marks it as active', () => {
      const encrypted = encryptToken('shpat_token_store_a', encryptionKey);
      const store = saveActiveStore({
        shopDomain: 'store-a.myshopify.com',
        accessTokenEncrypted: encrypted.ciphertext,
        tokenIv: encrypted.iv,
        tokenAuthTag: encrypted.authTag,
        scope: 'write_products',
        scopesGranted: 'write_products',
        storeName: 'Store A',
        storeCurrency: 'USD',
      });

      expect(store.id).toBeDefined();
      expect(store.shop_domain).toBe('store-a.myshopify.com');
      expect(store.is_active).toBe(1);
      expect(store.store_currency).toBe('USD');

      const active = getActiveStore();
      expect(active?.shop_domain).toBe('store-a.myshopify.com');
    });

    it('enforces single-store active rule: connecting Store B deactivates Store A (AT-05)', () => {
      // Connect Store A
      const encA = encryptToken('shpat_token_store_a', encryptionKey);
      saveActiveStore({
        shopDomain: 'store-a.myshopify.com',
        accessTokenEncrypted: encA.ciphertext,
        tokenIv: encA.iv,
        tokenAuthTag: encA.authTag,
        scope: 'write_products',
        scopesGranted: 'write_products',
        storeName: 'Store A',
        storeCurrency: 'USD',
      });

      // Connect Store B
      const encB = encryptToken('shpat_token_store_b', encryptionKey);
      saveActiveStore({
        shopDomain: 'store-b.myshopify.com',
        accessTokenEncrypted: encB.ciphertext,
        tokenIv: encB.iv,
        tokenAuthTag: encB.authTag,
        scope: 'write_products',
        scopesGranted: 'write_products',
        storeName: 'Store B',
        storeCurrency: 'EUR',
      });

      // Verify Store A is now inactive
      const storeA = getStoreByDomain('store-a.myshopify.com');
      expect(storeA?.is_active).toBe(0);

      // Verify Store B is active
      const storeB = getStoreByDomain('store-b.myshopify.com');
      expect(storeB?.is_active).toBe(1);

      // Verify getActiveStore returns Store B
      const active = getActiveStore();
      expect(active?.shop_domain).toBe('store-b.myshopify.com');
      expect(active?.store_currency).toBe('EUR');
    });

    it('wipes token fields with zeroes on disconnect (M2-12)', () => {
      const enc = encryptToken('shpat_token_secret', encryptionKey);
      saveActiveStore({
        shopDomain: 'store-wipe.myshopify.com',
        accessTokenEncrypted: enc.ciphertext,
        tokenIv: enc.iv,
        tokenAuthTag: enc.authTag,
        scope: 'write_products',
        scopesGranted: 'write_products',
        storeName: 'Store Wipe',
        storeCurrency: 'USD',
      });

      const success = wipeAndDisconnectStore('store-wipe.myshopify.com');
      expect(success).toBe(true);

      const store = getStoreByDomain('store-wipe.myshopify.com');
      expect(store?.is_active).toBe(0);
      // Verify token fields are zero-filled strings
      expect(store?.access_token).toBe('0'.repeat(enc.ciphertext.length));
      expect(store?.token_iv).toBe('0'.repeat(enc.iv.length));
      expect(store?.token_auth_tag).toBe('0'.repeat(enc.authTag.length));
    });
  });

  describe('Auth Code Exchange & JWT Lifecycle (AT-03, AT-04)', () => {
    it('generates a single-use code and exchanges it for a valid JWT', () => {
      const code = generateSingleUseAuthCode(1, 'my-shop.myshopify.com');
      expect(code.length).toBe(64); // 32 bytes hex

      const result = consumeSingleUseAuthCode(code);
      expect(result).not.toBeNull();
      expect(result?.storeId).toBe(1);
      expect(result?.shopDomain).toBe('my-shop.myshopify.com');

      // Replay attempt fails (AT-04)
      const replay = consumeSingleUseAuthCode(code);
      expect(replay).toBeNull();
    });

    it('signs and verifies JWT tokens without exposing secrets', () => {
      const token = signJwt({ storeId: 42, storeDomain: 'test-shop.myshopify.com' });
      expect(typeof token).toBe('string');

      const payload = verifyJwt(token);
      expect(payload.storeId).toBe(42);
      expect(payload.storeDomain).toBe('test-shop.myshopify.com');
    });
  });

  describe('API Endpoints Integration', () => {
    it('GET /auth/shopify redirects to Shopify with CSRF state', async () => {
      const res = await request(app).get('/auth/shopify?shop=valid-store.myshopify.com');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('https://valid-store.myshopify.com/admin/oauth/authorize?');
      expect(res.headers.location).toContain('client_id=test_client_id');
      expect(res.headers.location).toContain('state=');
      expect(res.headers.location).toContain('grant_options%5B%5D=offline');
    });

    it('GET /auth/shopify rejects invalid store domains with 400', async () => {
      const res = await request(app).get('/auth/shopify?shop=evil.com');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_SHOP_DOMAIN');
    });

    it('POST /auth/exchange exchanges valid code for JWT and returns store currency', async () => {
      // 1. Setup active store in DB
      const enc = encryptToken('shpat_token_123', encryptionKey);
      const store = saveActiveStore({
        shopDomain: 'active-store.myshopify.com',
        accessTokenEncrypted: enc.ciphertext,
        tokenIv: enc.iv,
        tokenAuthTag: enc.authTag,
        scope: 'write_products',
        scopesGranted: 'write_products',
        storeName: 'Active Store Test',
        storeCurrency: 'USD',
      });

      // 2. Generate code
      const code = generateSingleUseAuthCode(store.id, store.shop_domain);

      // 3. Exchange code
      const res = await request(app).post('/auth/exchange').send({ code });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.store_name).toBe('Active Store Test');
      expect(res.body.store_currency).toBe('USD');
      expect(res.body.shop_domain).toBe('active-store.myshopify.com');
    });

    it('POST /auth/exchange rejects consumed or invalid codes with 400', async () => {
      const res = await request(app).post('/auth/exchange').send({ code: 'invalid_code' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
    });

    it('GET /api/status returns connected store details with valid JWT', async () => {
      // Setup active store in DB
      const enc = encryptToken('shpat_token_status', encryptionKey);
      const store = saveActiveStore({
        shopDomain: 'status-store.myshopify.com',
        accessTokenEncrypted: enc.ciphertext,
        tokenIv: enc.iv,
        tokenAuthTag: enc.authTag,
        scope: 'write_products',
        scopesGranted: 'write_products',
        storeName: 'Status Store',
        storeCurrency: 'CAD',
      });

      const token = signJwt({ storeId: store.id, storeDomain: store.shop_domain });

      const res = await request(app)
        .get('/api/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(res.body.shop_domain).toBe('status-store.myshopify.com');
      expect(res.body.store_name).toBe('Status Store');
      expect(res.body.store_currency).toBe('CAD');
    });

    it('GET /api/status returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/status');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_TOKEN');
    });

    it('GET /api/status returns 401 when store was replaced and is no longer active', async () => {
      // Setup Store A
      const encA = encryptToken('shpat_a', encryptionKey);
      const storeA = saveActiveStore({
        shopDomain: 'store-a.myshopify.com',
        accessTokenEncrypted: encA.ciphertext,
        tokenIv: encA.iv,
        tokenAuthTag: encA.authTag,
        scope: 'write_products',
        scopesGranted: 'write_products',
        storeName: 'Store A',
        storeCurrency: 'USD',
      });

      const tokenA = signJwt({ storeId: storeA.id, storeDomain: storeA.shop_domain });

      // Connect Store B (deactivating Store A)
      const encB = encryptToken('shpat_b', encryptionKey);
      saveActiveStore({
        shopDomain: 'store-b.myshopify.com',
        accessTokenEncrypted: encB.ciphertext,
        tokenIv: encB.iv,
        tokenAuthTag: encB.authTag,
        scope: 'write_products',
        scopesGranted: 'write_products',
        storeName: 'Store B',
        storeCurrency: 'EUR',
      });

      // Attempt status call with Token A
      const res = await request(app)
        .get('/api/status')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('STORE_NOT_FOUND');
    });

    it('POST /api/disconnect disconnects active store and wipes credentials', async () => {
      const enc = encryptToken('shpat_token_disconnect', encryptionKey);
      const store = saveActiveStore({
        shopDomain: 'disc-store.myshopify.com',
        accessTokenEncrypted: enc.ciphertext,
        tokenIv: enc.iv,
        tokenAuthTag: enc.authTag,
        scope: 'write_products',
        scopesGranted: 'write_products',
        storeName: 'Disconnect Store',
        storeCurrency: 'USD',
      });

      const token = signJwt({ storeId: store.id, storeDomain: store.shop_domain });

      const res = await request(app)
        .post('/api/disconnect')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify active store is now null
      const active = getActiveStore();
      expect(active).toBeNull();
    });
  });
});
