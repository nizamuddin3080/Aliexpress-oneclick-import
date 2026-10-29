import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  validateShopDomain,
  createStateNonce,
  verifyAndConsumeStateNonce,
  buildShopifyAuthUrl,
  verifyShopifyHmac,
} from '../src/auth/oauth.js';

describe('Shopify OAuth Security & Validation (M2-03, M2-04, AT-01, AT-02)', () => {
  const clientSecret = 'test_shopify_client_secret_xyz123';
  process.env.SHOPIFY_CLIENT_ID = 'test_client_id';

  describe('Shop Domain Validation', () => {
    it('accepts valid myshopify.com domains', () => {
      expect(validateShopDomain('my-store.myshopify.com')).toBe(true);
      expect(validateShopDomain('store123.myshopify.com')).toBe(true);
      expect(validateShopDomain('test.myshopify.com')).toBe(true);
    });

    it('rejects invalid or spoofed domains', () => {
      expect(validateShopDomain('evil.com')).toBe(false);
      expect(validateShopDomain('myshopify.com')).toBe(false);
      expect(validateShopDomain('my-store.myshopify.com.evil.com')).toBe(false);
      expect(validateShopDomain('not-a-url')).toBe(false);
      expect(validateShopDomain('')).toBe(false);
      expect(validateShopDomain('http://my-store.myshopify.com')).toBe(false);
    });
  });

  describe('State Nonce CSRF Protection', () => {
    it('generates a nonce and successfully validates it once', () => {
      const state = createStateNonce();
      expect(state.length).toBe(48); // 24 bytes in hex

      // First verification succeeds
      expect(verifyAndConsumeStateNonce(state)).toBe(true);

      // Replay fails (enforced single-use)
      expect(verifyAndConsumeStateNonce(state)).toBe(false);
    });

    it('rejects unknown or invalid state nonces', () => {
      expect(verifyAndConsumeStateNonce('fake_nonce_12345')).toBe(false);
      expect(verifyAndConsumeStateNonce('')).toBe(false);
    });
  });

  describe('Authorization URL Generation', () => {
    it('builds a secure Shopify authorize URL with offline access mode', () => {
      const url = buildShopifyAuthUrl('my-store.myshopify.com', 'test_nonce_state');
      expect(url).toContain('https://my-store.myshopify.com/admin/oauth/authorize?');
      expect(url).toContain('state=test_nonce_state');
      expect(url).toContain('grant_options%5B%5D=offline'); // URL-encoded grant_options[]=offline
      expect(url).toContain('redirect_uri=');
    });
  });

  describe('HMAC Signature Verification (AT-01)', () => {
    function generateValidHmac(params: Record<string, string>, secret: string): string {
      const message = Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&');

      return crypto.createHmac('sha256', secret).update(message).digest('hex');
    }

    it('validates authentic Shopify HMAC signatures', () => {
      const params = {
        code: 'auth_code_from_shopify',
        shop: 'my-store.myshopify.com',
        state: 'nonce_123',
        timestamp: '1700000000',
      };

      const hmac = generateValidHmac(params, clientSecret);
      const query = { ...params, hmac };

      expect(verifyShopifyHmac(query, clientSecret)).toBe(true);
    });

    it('rejects tampered query parameters', () => {
      const params = {
        code: 'auth_code_from_shopify',
        shop: 'my-store.myshopify.com',
        state: 'nonce_123',
        timestamp: '1700000000',
      };

      const hmac = generateValidHmac(params, clientSecret);

      // Tamper with code parameter
      const tamperedQuery = {
        ...params,
        code: 'tampered_code',
        hmac,
      };

      expect(verifyShopifyHmac(tamperedQuery, clientSecret)).toBe(false);
    });

    it('rejects when HMAC is missing', () => {
      const query = {
        code: 'auth_code',
        shop: 'my-store.myshopify.com',
      };

      expect(verifyShopifyHmac(query, clientSecret)).toBe(false);
    });
  });
});
