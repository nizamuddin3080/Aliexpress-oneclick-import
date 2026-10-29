import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';

export interface JwtPayload {
  storeId: number;
  storeDomain: string;
}

interface AuthCodeEntry {
  storeId: number;
  shopDomain: string;
  expiresAt: number;
}

// In-memory single-use authorization code store (TTL: 60 seconds)
const authCodeStore = new Map<string, AuthCodeEntry>();

// Periodic cleanup of expired auth codes
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of authCodeStore.entries()) {
    if (now > entry.expiresAt) {
      authCodeStore.delete(code);
    }
  }
}, 30000).unref();

/**
 * Generates a short-lived, single-use authorization code (TTL: 60 seconds)
 * for secure handoff between OAuth redirect and extension.
 */
export function generateSingleUseAuthCode(storeId: number, shopDomain: string): string {
  const code = crypto.randomBytes(32).toString('hex');
  const now = Date.now();

  authCodeStore.set(code, {
    storeId,
    shopDomain,
    expiresAt: now + 60 * 1000,
  });

  return code;
}

/**
 * Validates and consumes a single-use authorization code.
 * Enforces single-use by deleting the code immediately.
 */
export function consumeSingleUseAuthCode(code: string): { storeId: number; shopDomain: string } | null {
  if (!code || typeof code !== 'string') {
    return null;
  }

  const entry = authCodeStore.get(code);
  if (!entry) {
    return null;
  }

  // Enforce single-use
  authCodeStore.delete(code);

  if (Date.now() > entry.expiresAt) {
    return null;
  }

  return {
    storeId: entry.storeId,
    shopDomain: entry.shopDomain,
  };
}

/**
 * Signs a 7-day bearer JWT containing minimal store identification.
 * Absolute rule: No Shopify access tokens or client secrets inside the JWT.
 */
export function signJwt(payload: JwtPayload, secret = config.JWT_SECRET): string {
  return jwt.sign(payload, secret, {
    expiresIn: '7d',
    algorithm: 'HS256',
  });
}

/**
 * Verifies a JWT and extracts the store payload.
 * Throws an error if invalid or expired.
 */
export function verifyJwt(token: string, secret = config.JWT_SECRET): JwtPayload {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;

  if (!decoded.storeId || !decoded.storeDomain) {
    throw new Error('Malformed JWT: missing store identification fields.');
  }

  return {
    storeId: Number(decoded.storeId),
    storeDomain: String(decoded.storeDomain),
  };
}
