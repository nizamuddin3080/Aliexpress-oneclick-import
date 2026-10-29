import { Router, type Request, type Response } from 'express';
import { checkAuthConfiguration } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  const authStatus = checkAuthConfiguration();

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'aliexpress-shopify-importer-server',
    version: '1.0.0',
    auth: {
      configured: authStatus.isConfigured,
      message: authStatus.actionMessage,
    },
  });
});
