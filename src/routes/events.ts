import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/authenticate';
import { createEvent, listEventDeliveries } from '../services/event-service';

const idParamsSchema = z.object({ id: z.string().uuid() });

const createEventSchema = z
  .object({
    type: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Must be a valid event type.'),
    payload: z.record(z.string(), z.unknown()),
    source: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

const clientId = (request: { clientId?: string }): string => {
  if (!request.clientId) {
    throw new Error('Authenticated client ID is missing.');
  }

  return request.clientId;
};

export const eventsRouter = Router();

eventsRouter.use(authenticate);

eventsRouter.post('/', async (request, response) => {
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
