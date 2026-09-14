import { Prisma } from '@prisma/client';
import { Router } from 'express';

import { authenticate } from '../middleware/authenticate';
import { ingestionRateLimiter } from '../middleware/ingestion-rate-limit';
import { createEvent, listEventDeliveries } from '../services/event-service';
import { createEventSchema, idParamsSchema } from '../validation/request-schemas';

const clientId = (request: { clientId?: string }): string => {
  if (!request.clientId) {
    throw new Error('Authenticated client ID is missing.');
  }

  return request.clientId;
};

export const eventsRouter = Router();

eventsRouter.use(authenticate);

eventsRouter.post('/', ingestionRateLimiter, async (request, response) => {
  const input = createEventSchema.parse(request.body);
  const result = await createEvent(clientId(request), {
    ...input,
    payload: input.payload as Prisma.InputJsonValue,
  });

  response.status(202).json(result);
});

eventsRouter.get('/:id/deliveries', async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const deliveries = await listEventDeliveries(clientId(request), id);

  response.status(200).json({ deliveries });
});
