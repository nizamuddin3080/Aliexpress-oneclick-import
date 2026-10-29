import { type Request, type Response, type NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Default: 10 requests per minute
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 10;

/**
 * In-memory sliding window rate limiter per authenticated store (or client IP).
 * Enforces M8-03: max 10 requests/min per store, returning HTTP 429.
 */
export function rateLimiter(
  maxRequests = MAX_REQUESTS,
  windowMs = WINDOW_MS
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    // Key by store ID if authenticated, or by IP
    const key = req.store?.id ? `store:${req.store.id}` : `ip:${req.ip || req.socket.remoteAddress}`;
    const now = Date.now();

    let entry = rateLimitMap.get(key);

    if (!entry || now > entry.resetAt) {
      entry = {
        count: 1,
        resetAt: now + windowMs,
      };
      rateLimitMap.set(key, entry);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.status(429).json({
        success: false,
        outcome: 'failed',
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Limit is ${maxRequests} requests per minute.`,
          retry_after_seconds: retryAfterSeconds,
          retryable: true,
        },
      });
      return;
    }

    entry.count += 1;
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - entry.count);
    next();
  };
}

/**
 * Resets the in-memory rate limiter table (used in tests).
 */
export function resetRateLimiter(): void {
  rateLimitMap.clear();
}
