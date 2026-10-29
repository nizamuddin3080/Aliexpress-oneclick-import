import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/db/database.js';

describe('Security Controls — Payload Limits & CORS (M8-04, M8-05)', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    initDatabase(':memory:');
    app = createApp();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('rejects JSON payloads exceeding 1 MB with HTTP 413 PAYLOAD_TOO_LARGE', async () => {
    // Generate ~1.2 MB string
    const largeTitle = 'A'.repeat(1.2 * 1024 * 1024);

    const res = await request(app)
      .post('/api/import')
      .send({ title: largeTitle });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.error.message).toContain('1 MB');
  });

  it('allows Chrome Extension origin in CORS headers', async () => {
    const res = await request(app)
      .options('/api/status')
      .set('Origin', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
    );
  });

  it('blocks unauthorized origins in production mode', async () => {
    // Temporarily simulate production
    process.env.NODE_ENV = 'production';
    process.env.EXTENSION_ID = 'my_extension_id_123';
    const prodApp = createApp();

    const res = await request(prodApp)
      .options('/api/status')
      .set('Origin', 'https://malicious-website.com')
      .set('Access-Control-Request-Method', 'GET');

    // CORS error produces 500 or omits CORS allow header
    expect(res.headers['access-control-allow-origin']).toBeUndefined();

    process.env.NODE_ENV = 'test';
  });
});
