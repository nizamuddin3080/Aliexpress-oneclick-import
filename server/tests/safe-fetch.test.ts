import { describe, it, expect } from 'vitest';
import {
  isPrivateOrReservedIp,
  validateSafeUrl,
  safeFetchImage,
  SafeFetchError,
} from '../src/validation/safe-fetch.js';

describe('Safe Fetch SSRF Protection (M8-01, M8-02)', () => {
  describe('Private and Reserved IP Classifier', () => {
    it('blocks loopback addresses (127.0.0.1, 127.x.x.x, ::1)', () => {
      expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('127.12.34.56')).toBe(true);
      expect(isPrivateOrReservedIp('::1')).toBe(true);
    });

    it('blocks Class A private range (10.0.0.0/8)', () => {
      expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('10.254.254.254')).toBe(true);
    });

    it('blocks Class B private range (172.16.0.0/12)', () => {
      expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
      // 172.32.0.1 is public
      expect(isPrivateOrReservedIp('172.32.0.1')).toBe(false);
    });

    it('blocks Class C private range (192.168.0.0/16)', () => {
      expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
      expect(isPrivateOrReservedIp('192.168.254.254')).toBe(true);
    });

    it('blocks cloud metadata and link-local range (169.254.0.0/16)', () => {
      expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIp('169.254.1.1')).toBe(true);
    });

    it('blocks multicast and broadcast ranges (224.0.0.0/4, 255.255.255.255)', () => {
      expect(isPrivateOrReservedIp('224.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('239.255.255.255')).toBe(true);
      expect(isPrivateOrReservedIp('255.255.255.255')).toBe(true);
    });

    it('allows valid public routable IP addresses', () => {
      expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
      expect(isPrivateOrReservedIp('47.88.12.34')).toBe(false);
    });
  });

  describe('URL Pre-validation', () => {
    it('allows valid HTTPS alicdn.com image URLs', () => {
      const url = validateSafeUrl('https://ae01.alicdn.com/kf/image1.jpg');
      expect(url.hostname).toBe('ae01.alicdn.com');
    });

    it('rejects non-HTTPS URLs', () => {
      expect(() => validateSafeUrl('http://ae01.alicdn.com/image.jpg')).toThrowError(SafeFetchError);
    });

    it('rejects foreign domains not on alicdn.com allowlist', () => {
      expect(() => validateSafeUrl('https://evil-server.com/image.jpg')).toThrowError(
        'Host "evil-server.com" is not in the allowed CDN domain list.'
      );
    });

    it('rejects URLs containing embedded user credentials', () => {
      expect(() => validateSafeUrl('https://admin:secret@ae01.alicdn.com/image.jpg')).toThrowError(
        'URLs with embedded user credentials are not permitted.'
      );
    });
  });

  describe('DNS Resolution and Rebinding Guard', () => {
    it('blocks requests where hostname resolves to a private or loopback IP', async () => {
      const mockDnsResolver = async (_host: string) => ['127.0.0.1'];

      await expect(
        safeFetchImage('https://ae01.alicdn.com/image.jpg', 0, mockDnsResolver)
      ).rejects.toThrow('belongs to a private, loopback, or reserved address space');
    });

    it('blocks requests where hostname resolves to AWS/Cloud metadata (169.254.169.254)', async () => {
      const mockDnsResolver = async (_host: string) => ['169.254.169.254'];

      await expect(
        safeFetchImage('https://ae01.alicdn.com/image.jpg', 0, mockDnsResolver)
      ).rejects.toThrow('belongs to a private, loopback, or reserved address space');
    });

    it('blocks requests exceeding maximum 1 redirect', async () => {
      await expect(
        safeFetchImage('https://ae01.alicdn.com/image.jpg', 2)
      ).rejects.toThrow('Maximum 1 redirect exceeded');
    });
  });
});
