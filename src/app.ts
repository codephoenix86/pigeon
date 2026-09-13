import express from 'express';

import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { bindRequestLogger, httpLogger } from './middleware/request-logging';
import { eventsRouter } from './routes/events';
import { healthRouter } from './routes/health';
import { subscriptionsRouter } from './routes/subscriptions';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(httpLogger);
  app.use(bindRequestLogger);
  app.use(express.json({ limit: '1mb' }));
  app.use('/health', healthRouter);
  app.use('/subscriptions', subscriptionsRouter);
  app.use('/events', eventsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
