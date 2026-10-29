import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../src/shared/config.js';

describe('Chrome Extension Scaffold Verification', () => {
  it('has a valid Manifest V3 file', () => {
    const manifestPath = path.resolve(__dirname, '../manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).toContain('scripting');
    expect(manifest.permissions).toContain('storage');
    expect(manifest.action.default_popup).toBe('popup/popup.html');
  });

  it('exposes minimal client configuration without secrets', () => {
    expect(CONFIG.BACKEND_URL).toBeDefined();
    expect(CONFIG.SUPPORTED_HOSTS).toContain('aliexpress.com');
    // Ensure no sensitive keys exist in client config
    expect((CONFIG as Record<string, unknown>).SHOPIFY_CLIENT_SECRET).toBeUndefined();
    expect((CONFIG as Record<string, unknown>).JWT_SECRET).toBeUndefined();
  });
});
