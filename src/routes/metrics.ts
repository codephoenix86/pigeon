import { Router } from 'express';

import { metricsRegistry } from '../services/metrics-service';

export const metricsRouter = Router();

metricsRouter.get('/', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', metricsRegistry.contentType);
  response.status(200).send(await metricsRegistry.metrics());
});
