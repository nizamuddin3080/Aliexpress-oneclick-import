import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken, generateEncryptionKey } from '../src/auth/crypto.js';

describe('AES-256-GCM Token Encryption (M2-02, AT-06)', () => {
  const testKey = generateEncryptionKey();

  it('performs full round-trip encryption and decryption', () => {
    const originalToken = 'shpat_test_access_token_1234567890abcdef';
    const encrypted = encryptToken(originalToken, testKey);

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.ciphertext).not.toBe(originalToken);

    const decrypted = decryptToken(encrypted.ciphertext, encrypted.iv, encrypted.authTag, testKey);
    expect(decrypted).toBe(originalToken);
  });

  it('rejects decryption when ciphertext is tampered with', () => {
    const originalToken = 'shpat_secret_token';
    const encrypted = encryptToken(originalToken, testKey);

    // Tamper with first byte of ciphertext
    const tamperedCiphertext =
      (encrypted.ciphertext[0] === 'a' ? 'b' : 'a') + encrypted.ciphertext.slice(1);

    expect(() => {
      decryptToken(tamperedCiphertext, encrypted.iv, encrypted.authTag, testKey);
    }).toThrow();
  });

  it('rejects decryption when auth tag is tampered with', () => {
    const originalToken = 'shpat_secret_token';
    const encrypted = encryptToken(originalToken, testKey);

    // Tamper with auth tag
    const tamperedTag = (encrypted.authTag[0] === '0' ? '1' : '0') + encrypted.authTag.slice(1);

    expect(() => {
      decryptToken(encrypted.ciphertext, encrypted.iv, tamperedTag, testKey);
    }).toThrow();
  });

  it('rejects decryption with an incorrect key', () => {
    const originalToken = 'shpat_secret_token';
    const encrypted = encryptToken(originalToken, testKey);
    const wrongKey = generateEncryptionKey();

    expect(() => {
      decryptToken(encrypted.ciphertext, encrypted.iv, encrypted.authTag, wrongKey);
    }).toThrow();
  });

  it('rejects invalid key lengths', () => {
    expect(() => {
      encryptToken('token', 'too_short_key');
    }).toThrow(/32-byte hex string/);
  });
});
