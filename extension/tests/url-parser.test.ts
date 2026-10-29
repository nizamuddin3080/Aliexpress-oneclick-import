import { describe, it, expect } from 'vitest';
import {
  parseAndValidateAliExpressUrl,
  normalizeAndValidateImageUrl,
} from '../src/content/url-parser.js';

describe('URL Parser & Security Allowlist (M3-09, M3-10, UV-01..UV-11)', () => {
  describe('AliExpress Source URLs', () => {
    it('accepts standard HTTPS AliExpress detail URLs (UV-01)', () => {
      const res = parseAndValidateAliExpressUrl('https://www.aliexpress.com/item/1005006123456789.html');
      expect(res.isValid).toBe(true);
      expect(res.productId).toBe('1005006123456789');
      expect(res.canonicalUrl).toBe('https://www.aliexpress.com/item/1005006123456789.html');
    });

    it('accepts Russian domain detail URLs (UV-02)', () => {
      const res = parseAndValidateAliExpressUrl('https://aliexpress.ru/item/1005006123456789.html');
      expect(res.isValid).toBe(true);
      expect(res.productId).toBe('1005006123456789');
    });

    it('accepts mobile subdomain URLs (UV-03)', () => {
      const res = parseAndValidateAliExpressUrl('https://m.aliexpress.com/item/1005006123456789.html?spm=a2g0n');
      expect(res.isValid).toBe(true);
      expect(res.productId).toBe('1005006123456789');
      expect(res.canonicalUrl).toBe('https://m.aliexpress.com/item/1005006123456789.html');
    });

    it('rejects insecure HTTP AliExpress URLs (UV-04)', () => {
      const res = parseAndValidateAliExpressUrl('http://www.aliexpress.com/item/1005006123456789.html');
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/Insecure URL/);
    });

    it('rejects foreign domains (UV-05)', () => {
      const res = parseAndValidateAliExpressUrl('https://evil.com/item/1005006123456789.html');
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/Disallowed host/);
    });

    it('rejects domain spoofing attempts (UV-06)', () => {
      const res = parseAndValidateAliExpressUrl('https://aliexpress.com.fake.com/item/1005006123456789.html');
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/Disallowed host/);
    });

    it('rejects URLs containing user credentials (UV-11)', () => {
      const res = parseAndValidateAliExpressUrl('https://user:pass@www.aliexpress.com/item/1005006123456789.html');
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/Credentials in URL are forbidden/);
    });
  });

  describe('AliExpress CDN Image URLs', () => {
    it('validates and normalizes valid alicdn image URLs (UV-07)', () => {
      const raw = 'https://ae01.alicdn.com/kf/S1234567_640x640.jpg';
      const clean = normalizeAndValidateImageUrl(raw);
      expect(clean).toBe('https://ae01.alicdn.com/kf/S1234567.jpg');
    });

    it('normalizes protocol-relative URLs (UV-08)', () => {
      const raw = '//img.alicdn.com/imgextra/i1/123.jpg';
      const clean = normalizeAndValidateImageUrl(raw);
      expect(clean).toBe('https://img.alicdn.com/imgextra/i1/123.jpg');
    });

    it('rejects HTTP image URLs (UV-09)', () => {
      const raw = 'http://ae01.alicdn.com/kf/S1234567.jpg';
      expect(normalizeAndValidateImageUrl(raw)).toBeNull();
    });

    it('rejects unapproved image CDNs (UV-10)', () => {
      const raw = 'https://untrusted-host.com/image.jpg';
      expect(normalizeAndValidateImageUrl(raw)).toBeNull();
    });
  });
});
