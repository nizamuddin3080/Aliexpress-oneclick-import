import { createApp } from './app.js';
import { config, checkAuthConfiguration } from './config.js';

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
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
