import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeShopifyGraphQL, ShopifyClientError } from '../src/shopify/client.js';

describe('Shopify Admin GraphQL Client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends GraphQL query with X-Shopify-Access-Token header and pinned 2026-01 API endpoint', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';

    globalThis.fetch = vi.fn(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = String(init?.body);

      return new Response(JSON.stringify({ data: { shop: { name: 'Test Shop' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await executeShopifyGraphQL({
      shopDomain: 'test-store.myshopify.com',
      accessToken: 'shpat_secret_123',
      query: 'query { shop { name } }',
    });

    expect(capturedUrl).toBe('https://test-store.myshopify.com/admin/api/2026-01/graphql.json');
    expect(capturedHeaders['X-Shopify-Access-Token']).toBe('shpat_secret_123');
    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedBody).toContain('shop { name }');
    expect(res.data).toEqual({ shop: { name: 'Test Shop' } });
  });

  it('throws UNAUTHORIZED on HTTP 401 response', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Unauthorized', { status: 401 });
    });

    await expect(
      executeShopifyGraphQL({
        shopDomain: 'test-store.myshopify.com',
        accessToken: 'bad_token',
        query: '{ shop { name } }',
      })
    ).rejects.toThrowError(ShopifyClientError);
  });

  it('throws RATE_LIMITED on HTTP 429 and parses Retry-After header', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '4.5' },
      });
    });

    try {
      await executeShopifyGraphQL({
        shopDomain: 'test-store.myshopify.com',
        accessToken: 'token',
        query: '{ shop { name } }',
      });
      expect.fail('Expected RATE_LIMITED error');
    } catch (err) {
      expect(err).toBeInstanceOf(ShopifyClientError);
      expect((err as ShopifyClientError).code).toBe('RATE_LIMITED');
      expect((err as ShopifyClientError).retryAfterSeconds).toBe(4.5);
    }
  });

  it('throws SHOPIFY_API_ERROR on HTTP 500 error', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Internal Server Error', { status: 500 });
    });

    await expect(
      executeShopifyGraphQL({
        shopDomain: 'test-store.myshopify.com',
        accessToken: 'token',
        query: '{ shop { name } }',
      })
    ).rejects.toThrow('Shopify Admin API returned server error HTTP 500');
  });

  it('throws TIMEOUT when AbortError occurs', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const signal = init?.signal;
      return new Promise((_, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    try {
      await executeShopifyGraphQL({
        shopDomain: 'test-store.myshopify.com',
        accessToken: 'token',
        query: '{ shop { name } }',
        timeoutMs: 50, // Short timeout for test
      });
      expect.fail('Expected TIMEOUT error');
    } catch (err) {
      expect(err).toBeInstanceOf(ShopifyClientError);
      expect((err as ShopifyClientError).code).toBe('TIMEOUT');
    }
  });

  it('throws UNAUTHORIZED when Shopify returns ACCESS_DENIED in GraphQL errors', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          errors: [
            {
              message: 'Access denied for productSet field. Required access: write_products access scope.',
              extensions: { code: 'ACCESS_DENIED' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    try {
      await executeShopifyGraphQL({
        shopDomain: 'test-store.myshopify.com',
        accessToken: 'token',
        query: 'mutation { productSet { product { id } } }',
      });
      expect.fail('Expected UNAUTHORIZED error');
    } catch (err) {
      expect(err).toBeInstanceOf(ShopifyClientError);
      expect((err as ShopifyClientError).code).toBe('UNAUTHORIZED');
      expect((err as Error).message).toContain('Access denied for productSet field');
    }
  });

  it('throws SHOPIFY_API_ERROR when Shopify returns generic GraphQL errors with HTTP 200', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          errors: [
            {
              message: 'Field mediaContentType is not defined by type FileSetInput',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    try {
      await executeShopifyGraphQL({
        shopDomain: 'test-store.myshopify.com',
        accessToken: 'token',
        query: 'mutation { productSet { product { id } } }',
      });
      expect.fail('Expected SHOPIFY_API_ERROR error');
    } catch (err) {
      expect(err).toBeInstanceOf(ShopifyClientError);
      expect((err as ShopifyClientError).code).toBe('SHOPIFY_API_ERROR');
      expect((err as Error).message).toContain('Field mediaContentType is not defined by type FileSetInput');
    }
  });
});
