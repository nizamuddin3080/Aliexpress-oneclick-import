import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Server Scaffold & Health Verification', () => {
  const app = createApp();

  it('GET /health returns 200 OK with health status and auth diagnostic', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('aliexpress-shopify-importer-server');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.auth).toBeDefined();
    expect(typeof res.body.auth.configured).toBe('boolean');
    expect(typeof res.body.auth.message).toBe('string');
  });

  it('GET /unknown-route returns 404 with structured JSON error', async () => {
    const res = await request(app).get('/non-existent-endpoint');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('POST with payload exceeding 1MB returns 413 Payload Too Large', async () => {
    // Generate a payload slightly above 1 MB (1024 * 1024 + 100 bytes)
    const largeData = 'a'.repeat(1024 * 1024 + 100);

    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: largeData }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('CORS allows chrome-extension origin in development', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
    );
  });
});
