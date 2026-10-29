import crypto from 'node:crypto';
import { config } from '../config.js';

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Validates and converts an encryption key into a 32-byte Buffer.
 */
function getKeyBuffer(keyHex?: string): Buffer {
  const hex = keyHex || config.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('ENCRYPTION_KEY is not configured in server environment.');
  }

  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must be a 32-byte hex string (got ${buf.length} bytes).`);
  }
  return buf;
}

/**
 * Encrypts a plaintext token using AES-256-GCM.
 * @param plaintext Plaintext Shopify access token
 * @param keyHex Optional 32-byte hex encryption key
 * @returns Object containing hex-encoded ciphertext, IV, and auth tag
 */
export function encryptToken(plaintext: string, keyHex?: string): EncryptedData {
  const key = getKeyBuffer(keyHex);
  // 12-byte initialization vector recommended for GCM
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypts an AES-256-GCM encrypted token.
 * Throws an error if the auth tag is invalid, tampered with, or key is incorrect.
 */
export function decryptToken(
  ciphertextHex: string,
  ivHex: string,
  authTagHex: string,
  keyHex?: string
): string {
  const key = getKeyBuffer(keyHex);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== 12 && iv.length !== 16) {
    throw new Error(`Invalid IV length: expected 12 or 16 bytes, got ${iv.length}.`);
  }

  if (authTag.length !== 16) {
    throw new Error(`Invalid auth tag length: expected 16 bytes, got ${authTag.length}.`);
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertextHex, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Generates a cryptographically secure 32-byte (64-char) hex key.
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
