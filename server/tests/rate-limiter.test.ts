import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { rateLimiter, resetRateLimiter } from '../src/middleware/rate-limiter.js';

describe('Rate Limiting Middleware (M8-03)', () => {
  let app: express.Express;

  beforeEach(() => {
    resetRateLimiter();
    app = express();
    // Use low threshold (3 requests/window) for test
    app.use(rateLimiter(3, 1000));
    app.get('/test', (_req, res) => {
      res.json({ ok: true });
    });
  });

  it('allows requests within limit and attaches rate limit headers', async () => {
    const res1 = await request(app).get('/test');
    expect(res1.status).toBe(200);
    expect(res1.headers['x-ratelimit-remaining']).toBe('2');

    const res2 = await request(app).get('/test');
    expect(res2.status).toBe(200);
    expect(res2.headers['x-ratelimit-remaining']).toBe('1');

    const res3 = await request(app).get('/test');
    expect(res3.status).toBe(200);
    expect(res3.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('returns HTTP 429 when threshold is exceeded with Retry-After header', async () => {
    // Consume limit of 3
    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');

    // 4th request exceeds limit
    const res4 = await request(app).get('/test');
    expect(res4.status).toBe(429);
    expect(res4.body.error.code).toBe('RATE_LIMITED');
    expect(res4.headers['retry-after']).toBeDefined();
    expect(res4.body.error.retry_after_seconds).toBeGreaterThan(0);
  });

  it('resets limit after time window expires', async () => {
    // Consume limit
    await request(app).get('/test');
    await request(app).get('/test');
    await request(app).get('/test');

    const blocked = await request(app).get('/test');
    expect(blocked.status).toBe(429);

    // Wait 1.1s for window to reset
    await new Promise(r => setTimeout(r, 1100));

    const fresh = await request(app).get('/test');
    expect(fresh.status).toBe(200);
  });
});
