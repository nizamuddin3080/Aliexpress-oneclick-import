import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { importRouter } from './routes/import.js';
import { rateLimiter } from './middleware/rate-limiter.js';

export function createApp(): Express {
  const app = express();

  // 1. Strict request size limiting (1 MB per API spec & security rules)
  app.use(express.json({ limit: '1mb' }));

  // 2. CORS configuration for Chrome Extension origin
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g., server-to-server or curl/tests)
        if (!origin) {
          return callback(null, true);
        }

        // Allow Chrome extension origins
        if (origin.startsWith('chrome-extension://')) {
          if (config.NODE_ENV === 'production' && config.EXTENSION_ID) {
            const expectedOrigin = `chrome-extension://${config.EXTENSION_ID}`;
            if (origin === expectedOrigin) {
              return callback(null, true);
            }
            return callback(new Error('CORS: Unauthorized extension ID'));
          }
          return callback(null, true);
        }

        // In development, allow localhost origin for testing
        if (config.NODE_ENV !== 'production' && origin.includes('localhost')) {
          return callback(null, true);
        }

        return callback(new Error('CORS: Origin not permitted'));
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // 3. Health & Diagnostic Routes
  app.use(healthRouter);

  // 4. Rate Limiting Middleware for Protected API
  app.use('/api', rateLimiter());

  // 5. Authentication & Store Lifecycle Routes
  app.use(authRouter);

  // 6. Import & Product Creation Routes
  app.use(importRouter);

  // 7. 404 Not Found Handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found on this server.',
      },
    });
  });

  // 5. Global Error Handler (Sanitizes error output; never exposes stack traces)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const isPayloadTooLarge = (err as { type?: string }).type === 'entity.too.large';

    if (isPayloadTooLarge) {
      res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds the 1 MB size limit.',
        },
      });
      return;
    }

    // Generic error response
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: config.NODE_ENV === 'production'
          ? 'An internal server error occurred.'
          : err.message,
      },
    });
  });

  return app;
}
