import { Router } from 'express';

export function createHealthRouter(healthCheck: () => Promise<void>) {
  const router = Router();

  router.get('/health', async (_request, response) => {
    try {
      await healthCheck();
      response.status(200).json({ status: 'ok', db: 'up' });
    } catch {
      response.status(503).json({ status: 'error', db: 'down' });
    }
  });

  return router;
}
