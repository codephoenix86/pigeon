import { Router } from 'express';

import { ingestionRateLimiter } from './event.middlewares';
import { authenticate } from '../auth/auth.middleware';
import { createEventController, listEventDeliveriesController } from './event.controller';

export const eventsRouter = Router();

eventsRouter.use(authenticate);

eventsRouter.post('/', ingestionRateLimiter, createEventController);
eventsRouter.get('/:id/deliveries', listEventDeliveriesController);
