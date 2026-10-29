import crypto from 'node:crypto';
import { config } from '../config.js';

interface StateEntry {
  createdAt: number;
  expiresAt: number;
}

// In-memory nonce store with 5-minute TTL
const stateStore = new Map<string, StateEntry>();

// Clean up expired nonces periodically
setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of stateStore.entries()) {
    if (now > entry.expiresAt) {
      stateStore.delete(nonce);
    }
  }
}, 60000).unref(); // unref so it does not keep process alive in tests

/**
 * Validates whether a shop domain strictly adheres to Shopify myshopify.com format.
 */
export function validateShopDomain(domain: string): boolean {
  if (!domain || typeof domain !== 'string') return false;
  const sanitized = domain.trim().toLowerCase();
  // Valid subdomains: alphanumeric, can include hyphens, ends with .myshopify.com
  const regex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
  return regex.test(sanitized);
}

/**
 * Generates and records a cryptographically secure CSRF state nonce (TTL: 5 minutes).
 */
export function createStateNonce(): string {
  const nonce = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  stateStore.set(nonce, {
    createdAt: now,
    expiresAt: now + 5 * 60 * 1000,
  });
  return nonce;
}

/**
 * Validates and consumes a state nonce. Enforces single-use.
 */
export function verifyAndConsumeStateNonce(nonce: string): boolean {
  if (!nonce) return false;
  const entry = stateStore.get(nonce);
  if (!entry) return false;

  stateStore.delete(nonce);

  if (Date.now() > entry.expiresAt) {
    return false;
  }
  return true;
}

/**
 * Builds the Shopify OAuth consent URL for offline access tokens.
 */
export function buildShopifyAuthUrl(shopDomain: string, state: string): string {
  const redirectUri = `${config.BACKEND_URL}/auth/shopify/callback`;
  const scopes = encodeURIComponent(config.SHOPIFY_SCOPES);
  const clientId = encodeURIComponent(config.SHOPIFY_CLIENT_ID);
  const encodedRedirect = encodeURIComponent(redirectUri);

  return (
    `https://${shopDomain}/admin/oauth/authorize?` +
    `client_id=${clientId}&` +
    `scope=${scopes}&` +
    `redirect_uri=${encodedRedirect}&` +
    `state=${state}&` +
    `grant_options%5B%5D=offline`
  );
}

/**
 * Validates the HMAC signature sent by Shopify in the callback query parameters.
 * Uses timingSafeEqual to protect against timing attacks.
 */
export function verifyShopifyHmac(
  queryParams: Record<string, string | string[] | undefined>,
  clientSecret: string
): boolean {
  const hmac = queryParams.hmac;
  if (!hmac || typeof hmac !== 'string' || !clientSecret) {
    return false;
  }

  // Build the message string from sorted query parameters, omitting 'hmac' and 'signature'
  const keys = Object.keys(queryParams)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort();

  const message = keys
    .map((k) => {
      const val = queryParams[k];
      return `${k}=${Array.isArray(val) ? val.join(',') : val}`;
    })
    .join('&');

  const generatedHmac = crypto
    .createHmac('sha256', clientSecret)
    .update(message)
    .digest('hex');

  const hmacBuffer = Buffer.from(hmac, 'utf8');
  const generatedBuffer = Buffer.from(generatedHmac, 'utf8');

  if (hmacBuffer.length !== generatedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(hmacBuffer, generatedBuffer);
}

export interface TokenExchangeResult {
  accessToken: string;
  scope: string;
}

/**
 * Exchanges the authorization code for an offline Shopify Admin access token.
 */
export async function exchangeCodeForToken(
  shopDomain: string,
  code: string,
  clientId = config.SHOPIFY_CLIENT_ID,
  clientSecret = config.SHOPIFY_CLIENT_SECRET
): Promise<TokenExchangeResult> {
  const url = `https://${shopDomain}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Shopify token exchange failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as { access_token?: string; scope?: string };

  if (!data.access_token) {
    throw new Error('Shopify response missing access_token.');
  }

  return {
    accessToken: data.access_token,
    scope: data.scope || config.SHOPIFY_SCOPES,
  };
}

export interface ShopDetails {
  name: string;
  currencyCode: string;
}

/**
 * Queries Shopify GraphQL Admin API to retrieve store name and base currency.
 */
export async function fetchShopCurrencyAndName(
  shopDomain: string,
  accessToken: string,
  apiVersion = config.SHOPIFY_API_VERSION
): Promise<ShopDetails> {
  const endpoint = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;

  const query = `
    query GetShopInfo {
      shop {
        name
        currencyCode
      }
    }
  `;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify shop query failed (${response.status}): ${text}`);
  }

  const result = (await response.json()) as {
    data?: { shop?: { name?: string; currencyCode?: string } };
    errors?: Array<{ message: string }>;
  };

  if (result.errors && result.errors.length > 0) {
    throw new Error(`Shopify GraphQL errors: ${result.errors.map((e) => e.message).join(', ')}`);
  }

  const shop = result.data?.shop;
  if (!shop?.currencyCode) {
    throw new Error('Shopify shop query did not return a valid currencyCode.');
  }

  return {
    name: shop.name || shopDomain,
    currencyCode: shop.currencyCode,
  };
}
