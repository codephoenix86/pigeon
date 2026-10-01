import express from 'express';

import { errorHandler, notFoundHandler } from './common/middleware/error.middleware';
import { bindRequestLogger, httpLogger } from './common/middleware/logger.middleware';
import { healthRouter } from './infra/health/health.routes';
import { metricsRouter } from './infra/metrics/metrics.routes';
import { deliveriesRouter } from './modules/delivery/delivery.routes';
import { eventsRouter } from './modules/event/event.routes';
import { subscriptionsRouter } from './modules/subscription/subscription.routes';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(httpLogger);
  app.use(bindRequestLogger);
  app.use(express.json({ limit: '1mb' }));
  app.use('/health', healthRouter);
  app.use('/metrics', metricsRouter);
  app.use('/deliveries', deliveriesRouter);
  app.use('/subscriptions', subscriptionsRouter);
  app.use('/events', eventsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
