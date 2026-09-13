import { Router } from 'express';

import { getHealth } from '../services/health-service';

export const healthRouter = Router();

healthRouter.get('/', async (_request, response) => {
  const health = await getHealth();

  response.setHeader('Cache-Control', 'no-store');
  response.status(health.isHealthy ? 200 : 503).json(health.body);
});
