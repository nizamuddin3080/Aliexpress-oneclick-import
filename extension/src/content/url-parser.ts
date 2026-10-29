export interface ParsedUrlResult {
  isValid: boolean;
  productId: string | null;
  canonicalUrl: string | null;
  error?: string;
}

const ALLOWED_ALIEXPRESS_HOSTS = [
  'aliexpress.com',
  'aliexpress.ru',
];

const ALLOWED_IMAGE_HOSTS = [
  'alicdn.com',
];

/**
 * Validates whether a hostname belongs to AliExpress or an approved subdomain.
 */
export function isAllowedAliExpressHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  for (const allowed of ALLOWED_ALIEXPRESS_HOSTS) {
    if (host === allowed || host.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Validates whether an image CDN hostname belongs to AliExpress CDN (*.alicdn.com).
 */
export function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  for (const allowed of ALLOWED_IMAGE_HOSTS) {
    if (host === allowed || host.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Extracts and validates the AliExpress product ID and canonical HTTPS URL.
 * Enforces HTTPS-only and strict hostname allowlisting.
 */
export function parseAndValidateAliExpressUrl(rawUrl: string): ParsedUrlResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, productId: null, canonicalUrl: null, error: 'Source URL is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { isValid: false, productId: null, canonicalUrl: null, error: 'Malformed source URL.' };
  }

  // 1. Enforce HTTPS strictly (reject insecure HTTP)
  if (parsed.protocol !== 'https:') {
    return {
      isValid: false,
      productId: null,
      canonicalUrl: null,
      error: 'Insecure URL: Only HTTPS AliExpress URLs are supported.',
    };
  }

  // 2. Reject credentials in URL
  if (parsed.username || parsed.password) {
    return {
      isValid: false,
      productId: null,
      canonicalUrl: null,
      error: 'Security violation: Credentials in URL are forbidden.',
    };
  }

  // 3. Validate hostname against AliExpress allowlist
  if (!isAllowedAliExpressHost(parsed.hostname)) {
    return {
      isValid: false,
      productId: null,
      canonicalUrl: null,
      error: `Disallowed host: ${parsed.hostname} is not an AliExpress domain.`,
    };
  }

  // 4. Extract numeric product ID from path (/item/1005006123456789.html or /item/1005006123456789)
  const itemMatch = parsed.pathname.match(/\/item\/(\d+)(?:\.html)?/i);
  if (!itemMatch || !itemMatch[1]) {
    return {
      isValid: false,
      productId: null,
      canonicalUrl: null,
      error: 'Could not extract product ID from AliExpress URL path.',
    };
  }

  const productId = itemMatch[1];
  const canonicalUrl = `https://${parsed.hostname}/item/${productId}.html`;

  return {
    isValid: true,
    productId,
    canonicalUrl,
  };
}

/**
 * Normalizes and validates an AliExpress CDN image URL.
 * Ensures HTTPS, approved alicdn.com host, and strips thumbnail downscaling suffixes.
 */
export function normalizeAndValidateImageUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  let urlStr = rawUrl.trim();

  // Handle protocol-relative URLs (e.g. //ae01.alicdn.com/kf/...)
  if (urlStr.startsWith('//')) {
    urlStr = `https:${urlStr}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' || !isAllowedImageHost(parsed.hostname)) {
    return null;
  }

  if (parsed.username || parsed.password) {
    return null;
  }

  // Strip thumbnail suffixes like _640x640.jpg or _50x50.jpg or _Q90.jpg while preserving extension
  let cleanPath = parsed.pathname;
  cleanPath = cleanPath.replace(/_\d+x\d+(\.(?:jpg|png|webp|jpeg))$/i, '$1');
  cleanPath = cleanPath.replace(/_Q\d+(\.(?:jpg|png|webp|jpeg))$/i, '$1');

  return `https://${parsed.hostname}${cleanPath}`;
}
