import { createApp } from './app.js';
import { config, checkAuthConfiguration } from './config.js';
import { initDatabase, closeDatabase } from './db/database.js';

// Initialize SQLite database
try {
  initDatabase(config.DATABASE_PATH);
  console.log(`[Server] SQLite database initialized at ${config.DATABASE_PATH}`);
} catch (err) {
  console.error('[Server Error] Failed to initialize SQLite database:', err);
  process.exit(1);
}

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log(`[Server] AliExpress-Shopify Importer running on port ${config.PORT}`);
  console.log(`[Server] Environment: ${config.NODE_ENV}`);

  const authStatus = checkAuthConfiguration();
  if (authStatus.isConfigured) {
    console.log('[Server] Shopify authentication credentials: CONFIGURED');
  } else {
    console.warn(`[Server Warning] ${authStatus.actionMessage}`);
  }
});

// Graceful shutdown handling
function shutdown(signal: string) {
  console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    closeDatabase();
    console.log('[Server] SQLite database and HTTP server closed.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
