import dotenv from 'dotenv';
import path from 'node:path';

// Load .env file if present
dotenv.config();

export interface ServerConfig {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  BACKEND_URL: string;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  DATABASE_PATH: string;
  SHOPIFY_API_VERSION: string;
  SHOPIFY_SCOPES: string;
  EXTENSION_ID: string;
}

const nodeEnv = (process.env.NODE_ENV as ServerConfig['NODE_ENV']) || 'development';

export const config: ServerConfig = {
  PORT: parseInt(process.env.PORT || '3456', 10),
  NODE_ENV: nodeEnv,
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3456',
  SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID || '',
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET || '',
  JWT_SECRET: process.env.JWT_SECRET || 'dev_jwt_secret_must_be_replaced_in_production',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
  DATABASE_PATH: process.env.DATABASE_PATH || path.resolve('data/importer.db'),
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || '2026-01',
  SHOPIFY_SCOPES: process.env.SHOPIFY_SCOPES || 'write_products',
  EXTENSION_ID: process.env.EXTENSION_ID || '',
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
