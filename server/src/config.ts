import dotenv from 'dotenv';
import path from 'node:path';

// Load .env file from current working directory or server subdirectory
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

export interface ServerConfig {
  readonly PORT: number;
  readonly NODE_ENV: 'development' | 'production' | 'test';
  readonly BACKEND_URL: string;
  readonly SHOPIFY_CLIENT_ID: string;
  readonly SHOPIFY_CLIENT_SECRET: string;
  readonly JWT_SECRET: string;
  readonly ENCRYPTION_KEY: string;
  readonly DATABASE_PATH: string;
  readonly SHOPIFY_API_VERSION: string;
  readonly SHOPIFY_SCOPES: string;
  readonly EXTENSION_ID: string;
}

export const config: ServerConfig = {
  get PORT(): number {
    return parseInt(process.env.PORT || '3456', 10);
  },
  get NODE_ENV(): 'development' | 'production' | 'test' {
    return (process.env.NODE_ENV as ServerConfig['NODE_ENV']) || 'development';
  },
  get BACKEND_URL(): string {
    return process.env.BACKEND_URL || 'http://localhost:3456';
  },
  get SHOPIFY_CLIENT_ID(): string {
    return process.env.SHOPIFY_CLIENT_ID || '';
  },
  get SHOPIFY_CLIENT_SECRET(): string {
    return process.env.SHOPIFY_CLIENT_SECRET || '';
  },
  get JWT_SECRET(): string {
    return process.env.JWT_SECRET || 'dev_jwt_secret_must_be_replaced_in_production';
  },
  get ENCRYPTION_KEY(): string {
    return process.env.ENCRYPTION_KEY || '';
  },
  get DATABASE_PATH(): string {
    return process.env.DATABASE_PATH || path.resolve('data/importer.db');
  },
  get SHOPIFY_API_VERSION(): string {
    return process.env.SHOPIFY_API_VERSION || '2026-01';
  },
  get SHOPIFY_SCOPES(): string {
    return process.env.SHOPIFY_SCOPES || 'write_products';
  },
  get EXTENSION_ID(): string {
    return process.env.EXTENSION_ID || '';
  },
};

export interface AuthStatus {
  isConfigured: boolean;
  missing: string[];
  actionMessage: string;
}

/**
 * Validates whether Shopify authentication credentials and secrets are configured.
 * Does not throw on server startup so the development server can run health checks.
 */
export function checkAuthConfiguration(): AuthStatus {
  const missing: string[] = [];

  if (!config.SHOPIFY_CLIENT_ID || config.SHOPIFY_CLIENT_ID === 'your_shopify_client_id_here') {
    missing.push('SHOPIFY_CLIENT_ID');
  }
  if (!config.SHOPIFY_CLIENT_SECRET || config.SHOPIFY_CLIENT_SECRET === 'your_shopify_client_secret_here') {
    missing.push('SHOPIFY_CLIENT_SECRET');
  }
  if (!config.ENCRYPTION_KEY || config.ENCRYPTION_KEY === 'your_32_byte_hex_encryption_key_here') {
    missing.push('ENCRYPTION_KEY');
  }

  const isConfigured = missing.length === 0;

  const actionMessage = isConfigured
    ? 'Shopify authentication and encryption are configured.'
    : `Shopify authentication is unconfigured. Missing variables: [${missing.join(', ')}]. ` +
      'Please copy .env.example to .env and configure your Shopify Dev Dashboard credentials and cryptographic keys before initiating OAuth.';

  return { isConfigured, missing, actionMessage };
}
