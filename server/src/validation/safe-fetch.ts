import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';

export type SafeFetchErrorCode =
  | 'SSRF_INVALID_URL'
  | 'SSRF_DISALLOWED_HOST'
  | 'SSRF_FORBIDDEN_IP'
  | 'SSRF_TOO_MANY_REDIRECTS'
  | 'SSRF_PAYLOAD_TOO_LARGE'
  | 'SSRF_TIMEOUT';

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

const ALLOWED_IMAGE_HOSTS = [
  'alicdn.com',
  'aliexpress-media.com',
  'aliexpress.com',
  'aliexpress.us',
  'taobaocdn.com',
  'tbcdn.cn',
  'alibaba.com',
];
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT_MS = 10_000; // 10s

/**
 * Checks whether an IPv4 address is in a private, loopback, link-local, or reserved range.
 */
export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IP treated as reserved
  }

  const [b0, b1] = parts;

  // 0.0.0.0/8 (current network)
  if (b0 === 0) return true;

  // 127.0.0.0/8 (loopback)
  if (b0 === 127) return true;

  // 10.0.0.0/8 (private)
  if (b0 === 10) return true;

  // 172.16.0.0/12 (private: 172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 !== undefined && b1 >= 16 && b1 <= 31) return true;

  // 192.168.0.0/16 (private)
  if (b0 === 192 && b1 === 168) return true;

  // 169.254.0.0/16 (link-local, cloud instance metadata)
  if (b0 === 169 && b1 === 254) return true;

  // 224.0.0.0/4 (multicast)
  if (b0 !== undefined && b0 >= 224 && b0 <= 239) return true;

  // 240.0.0.0/4 (reserved) & 255.255.255.255 (broadcast)
  if (b0 !== undefined && b0 >= 240) return true;

  return false;
}

/**
 * Checks whether an IPv6 address is in a loopback, unique local, or reserved range.
 */
export function isPrivateOrReservedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.slice(7);
    return isPrivateOrReservedIpv4(ipv4Part);
  }

  // fc00::/7 (unique local address)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // fe80::/10 (link-local)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

  // ff00::/8 (multicast)
  if (normalized.startsWith('ff')) return true;

  return false;
}

/**
 * Validates whether an IP address is private or reserved.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (ip.includes(':')) {
    return isPrivateOrReservedIpv6(ip);
  }
  return isPrivateOrReservedIpv4(ip);
}

/**
 * Validates a target URL before fetching:
 * - Must use HTTPS
 * - Hostname must match allowed CDN domain (*.alicdn.com)
 * - Must not contain embedded credentials (userinfo)
 */
export function validateSafeUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new SafeFetchError('SSRF_INVALID_URL', `Invalid URL: "${urlStr}"`);
  }

  if (parsed.protocol !== 'https:') {
    throw new SafeFetchError('SSRF_INVALID_URL', `Invalid protocol: "${parsed.protocol}". Only HTTPS is permitted.`);
  }

  if (parsed.username || parsed.password) {
    throw new SafeFetchError('SSRF_INVALID_URL', 'URLs with embedded user credentials are not permitted.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAllowed = ALLOWED_IMAGE_HOSTS.some(
    domain => hostname === domain || hostname.endsWith('.' + domain)
  );

  if (!isAllowed) {
    throw new SafeFetchError('SSRF_DISALLOWED_HOST', `Host "${hostname}" is not in the allowed CDN domain list.`);
  }

  return parsed;
}

export interface SafeFetchResult {
  buffer: Buffer;
  contentType: string;
  statusCode: number;
}

/**
 * Safe Fetch implementation defending against SSRF and DNS rebinding:
 * 1. Resolves hostname to IP addresses via DNS.
 * 2. Verifies that all resolved IPs do NOT fall into private or loopback ranges.
 * 3. Connects directly to the resolved IP using TLS SNI and Host header.
 * 4. Revalidates redirects (maximum 1 redirect allowed).
 * 5. Caps maximum payload at 10 MB and enforces 10s timeout.
 */
export async function safeFetchImage(
  urlStr: string,
  redirectCount = 0,
  dnsResolver: (host: string) => Promise<string[]> = defaultDnsLookup
): Promise<SafeFetchResult> {
  if (redirectCount > 1) {
    throw new SafeFetchError('SSRF_TOO_MANY_REDIRECTS', 'Maximum 1 redirect exceeded.');
  }

  const parsedUrl = validateSafeUrl(urlStr);
  const hostname = parsedUrl.hostname;

  // 1. Resolve DNS before connection
  const resolvedIps = await dnsResolver(hostname);
  if (!resolvedIps || resolvedIps.length === 0) {
    throw new SafeFetchError('SSRF_FORBIDDEN_IP', `Could not resolve hostname "${hostname}".`);
  }

  // 2. Enforce IP range checks
  for (const ip of resolvedIps) {
    if (isPrivateOrReservedIp(ip)) {
      throw new SafeFetchError(
        'SSRF_FORBIDDEN_IP',
        `Resolved IP ${ip} for host "${hostname}" belongs to a private, loopback, or reserved address space.`
      );
    }
  }

  const targetIp = resolvedIps[0]!;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new SafeFetchError('SSRF_TIMEOUT', `Safe fetch timed out after ${FETCH_TIMEOUT_MS}ms.`));
    }, FETCH_TIMEOUT_MS);

    // Pin connection to target IP while preserving SNI and Host header
    const reqOptions: https.RequestOptions = {
      hostname: targetIp,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        Host: hostname,
        'User-Agent': 'AliExpress-Shopify-OneClick-Importer/1.0',
        Accept: 'image/jpeg, image/png, image/webp, image/*',
      },
      servername: hostname, // Required for SNI TLS handshake with CDN
      rejectUnauthorized: true,
    };

    const req = https.request(reqOptions, (res: http.IncomingMessage) => {
      // 3. Handle redirects (re-evaluating rules)
      if (
        res.statusCode &&
        [301, 302, 307, 308].includes(res.statusCode) &&
        res.headers.location
      ) {
        clearTimeout(timeout);
        req.destroy();
        const redirectUrl = new URL(res.headers.location, urlStr).toString();
        safeFetchImage(redirectUrl, redirectCount + 1, dnsResolver)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        clearTimeout(timeout);
        reject(
          new Error(`Safe fetch received unexpected HTTP status ${res.statusCode}`)
        );
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      res.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_IMAGE_SIZE_BYTES) {
          clearTimeout(timeout);
          req.destroy();
          reject(
            new SafeFetchError(
              'SSRF_PAYLOAD_TOO_LARGE',
              `Payload exceeds maximum permitted size of ${MAX_IMAGE_SIZE_BYTES} bytes.`
            )
          );
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        clearTimeout(timeout);
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || 'image/jpeg',
          statusCode: res.statusCode || 200,
        });
      });

      res.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    req.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });

    req.end();
  });
}

async function defaultDnsLookup(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true });
  return records.map(r => r.address);
}
