import { Prisma } from '@prisma/client';
import type { RequestHandler } from 'express';

import { createEventSchema, eventIdParamsSchema } from './event.schema';
import { createEvent, listEventDeliveries } from './event.service';

const clientId = (request: { clientId?: string }): string => {
  if (!request.clientId) {
    throw new Error('Authenticated client ID is missing.');
  }

  return request.clientId;
};

export const createEventController: RequestHandler = async (request, response) => {
  const input = createEventSchema.parse(request.body);
  const result = await createEvent(clientId(request), {
    ...input,
    payload: input.payload as Prisma.InputJsonValue,
  });

  response.status(202).json(result);
};

export const listEventDeliveriesController: RequestHandler = async (request, response) => {
  const { id } = eventIdParamsSchema.parse(request.params);
  const deliveries = await listEventDeliveries(clientId(request), id);

  response.status(200).json({ deliveries });
};
