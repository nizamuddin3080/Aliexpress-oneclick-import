import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  initDatabase,
  closeDatabase,
  saveActiveStore,
  getImportAttempt,
  reserveImportAttempt,
  updateImportAttempt,
} from '../src/db/database.js';
import { signJwt } from '../src/auth/jwt.js';
import { encryptToken, generateEncryptionKey } from '../src/auth/crypto.js';

describe('Import Routes & Concurrency Tests', () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  let activeStoreId: number;
  const originalFetch = globalThis.fetch;
  const testEncryptionKey = generateEncryptionKey();

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = testEncryptionKey;
    process.env.JWT_SECRET = 'test_jwt_secret_key_12345';
    vi.restoreAllMocks();
    initDatabase(':memory:');
    app = createApp();

    const enc = encryptToken('shpat_test_secret_token_12345');
    const store = saveActiveStore({
      shopDomain: 'demo-store.myshopify.com',
      accessTokenEncrypted: enc.ciphertext,
      tokenIv: enc.iv,
      tokenAuthTag: enc.authTag,
      scope: 'write_products',
      scopesGranted: 'write_products',
      storeName: 'Demo Store',
      storeCurrency: 'USD',
    });
    activeStoreId = store.id;

    token = signJwt({
      storeId: store.id,
      storeDomain: store.shop_domain,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    closeDatabase();
  });

  const validPayload = {
    source_product_id: '1005001122334455',
    source_url: 'https://www.aliexpress.com/item/1005001122334455.html',
    source_currency: 'USD',
    title: 'Wireless Gaming Mouse',
    description_html: '<p>Ergonomic wireless gaming mouse</p>',
    markup_percentage: 25,
    images: [
      { url: 'https://ae01.alicdn.com/kf/mouse1.jpg', alt: 'Mouse front' },
      { url: 'https://ae01.alicdn.com/kf/mouse2.jpg', alt: 'Mouse side' },
    ],
    options: [{ name: 'Color', values: ['Black', 'White'] }],
    variants: [
      { option_values: { Color: 'Black' }, price: '20.00', sku: 'MS-BLK' },
      { option_values: { Color: 'White' }, price: '20.00', sku: 'MS-WHT' },
    ],
  };

  it('GET /api/import/:sourceId returns not_imported when no attempt exists', async () => {
    const res = await request(app)
      .get('/api/import/1005001122334455')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'not_imported' });
  });

  it('POST /api/import creates product as Draft and returns 201 with Shopify Admin URL', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            productSet: {
              product: {
                id: 'gid://shopify/Product/987654321',
                title: 'Wireless Gaming Mouse',
                handle: 'wireless-gaming-mouse',
                status: 'DRAFT',
                media: {
                  nodes: [
                    { id: 'gid://shopify/MediaImage/1', status: 'READY' },
                    { id: 'gid://shopify/MediaImage/2', status: 'READY' },
                  ],
                },
              },
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await request(app)
      .post('/api/import')
      .set('Authorization', `Bearer ${token}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.outcome).toBe('completed');
    expect(res.body.shopify_product_id).toBe('gid://shopify/Product/987654321');
    expect(res.body.shopify_admin_url).toBe(
      'https://admin.shopify.com/store/demo-store/products/987654321'
    );
    expect(res.body.images_succeeded).toBe(2);
    expect(res.body.images_failed).toBe(0);

    // Verify record in database
    const attempt = getImportAttempt(activeStoreId, '1005001122334455');
    expect(attempt).toBeDefined();
    expect(attempt?.status).toBe('completed');
    expect(attempt?.shopify_product_id).toBe('gid://shopify/Product/987654321');
  });

  it('POST /api/import handles partial image failures and returns completed_partial_images', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            productSet: {
              product: {
                id: 'gid://shopify/Product/987654321',
                title: 'Wireless Gaming Mouse',
                handle: 'wireless-gaming-mouse',
                status: 'DRAFT',
                media: {
                  nodes: [
                    { id: 'gid://shopify/MediaImage/1', status: 'READY' },
                    { id: 'gid://shopify/MediaImage/2', status: 'FAILED' }, // Failed image
                  ],
                },
              },
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await request(app)
      .post('/api/import')
      .set('Authorization', `Bearer ${token}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.outcome).toBe('completed_partial_images');
    expect(res.body.images_succeeded).toBe(1);
    expect(res.body.images_failed).toBe(1);
    expect(res.body.warnings).toBeDefined();
    expect(res.body.warnings[0]).toContain('1 of 2 images could not be uploaded');
  });

  it('POST /api/import returns 409 DUPLICATE_PRODUCT when product has already been imported', async () => {
    // 1. First import succeeds
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            productSet: {
              product: {
                id: 'gid://shopify/Product/987654321',
                title: 'Wireless Gaming Mouse',
                status: 'DRAFT',
                media: { nodes: [] },
              },
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const firstRes = await request(app)
      .post('/api/import')
      .set('Authorization', `Bearer ${token}`)
      .send(validPayload);
    expect(firstRes.status).toBe(201);

    // 2. Second import attempt for same item is blocked
    const duplicateRes = await request(app)
      .post('/api/import')
      .set('Authorization', `Bearer ${token}`)
      .send(validPayload);

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error.code).toBe('DUPLICATE_PRODUCT');
    expect(duplicateRes.body.error.shopify_admin_url).toBe(
      'https://admin.shopify.com/store/demo-store/products/987654321'
    );
  });

  it('handles timeout by setting status to needs_reconciliation and returning 502 UNKNOWN_OUTCOME', async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });

    const res = await request(app)
      .post('/api/import')
      .set('Authorization', `Bearer ${token}`)
      .send(validPayload);

    expect(res.status).toBe(502);
    expect(res.body.outcome).toBe('needs_reconciliation');
    expect(res.body.error.code).toBe('UNKNOWN_OUTCOME');
    expect(res.body.error.retryable).toBe(false);
    expect(res.body.error.shopify_admin_url).toContain('https://admin.shopify.com/store/demo-store/products');

    const attempt = getImportAttempt(activeStoreId, '1005001122334455');
    expect(attempt?.status).toBe('needs_reconciliation');
  });

  it('handles Shopify userErrors by setting status to failed and returning 422 SHOPIFY_VALIDATION_ERROR', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            productSet: {
              product: null,
              userErrors: [
                {
                  field: ['input', 'title'],
                  message: 'Title is too long or contains invalid characters',
                  code: 'INVALID',
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await request(app)
      .post('/api/import')
      .set('Authorization', `Bearer ${token}`)
      .send(validPayload);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SHOPIFY_VALIDATION_ERROR');
    expect(res.body.error.fields[0].message).toContain('Title is too long');

    const attempt = getImportAttempt(activeStoreId, '1005001122334455');
    expect(attempt?.status).toBe('failed');
  });

  it('reconciles needs_reconciliation with Shopify when checking status', async () => {
    // 1. Manually insert attempt in needs_reconciliation state
    reserveImportAttempt({
      storeId: activeStoreId,
      sourceProductId: '9999999999',
      sourceUrl: 'https://www.aliexpress.com/item/9999999999.html',
      productTitle: 'Reconciled Wireless Mouse',
      sourceCurrency: 'USD',
      markupPercentage: 25,
      imagesRequested: 2,
    });
    const inserted = getImportAttempt(activeStoreId, '9999999999')!;
    updateImportAttempt(inserted.id, {
      status: 'needs_reconciliation',
      errorMessage: 'Simulated timeout',
    });

    // Mock reconciliation response: Shopify HAS the product
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            products: {
              nodes: [
                {
                  id: 'gid://shopify/Product/777888',
                  title: 'Reconciled Wireless Mouse',
                  status: 'DRAFT',
                  metafields: {
                    nodes: [
                      { key: 'aliexpress_source_id', value: '9999999999' },
                    ],
                  },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    // Check status
    const statusRes = await request(app)
      .get('/api/import/9999999999')
      .set('Authorization', `Bearer ${token}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('completed');
    expect(statusRes.body.shopify_product_id).toBe('gid://shopify/Product/777888');
    expect(statusRes.body.shopify_admin_url).toBe(
      'https://admin.shopify.com/store/demo-store/products/777888'
    );
  });

  it('Concurrency test: 2 parallel import requests for the same source ID result in exactly 1 reservation and 1 409 error', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      // Add slight delay to simulate network latency
      await new Promise(r => setTimeout(r, 40));
      return new Response(
        JSON.stringify({
          data: {
            productSet: {
              product: {
                id: 'gid://shopify/Product/555123',
                title: 'Parallel Mouse',
                status: 'DRAFT',
                media: { nodes: [] },
              },
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const payload = {
      ...validPayload,
      source_product_id: '888877776666',
    };

    // Execute both in parallel
    const [res1, res2] = await Promise.all([
      request(app).post('/api/import').set('Authorization', `Bearer ${token}`).send(payload),
      request(app).post('/api/import').set('Authorization', `Bearer ${token}`).send(payload),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // One must be 201 Created and one must be 409 Conflict
    expect(statuses).toEqual([201, 409]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    expect(['IMPORT_IN_PROGRESS', 'DUPLICATE_PRODUCT']).toContain(
      conflictRes.body.error.code
    );
  });
});
