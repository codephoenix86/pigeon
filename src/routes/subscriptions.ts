import { SubscriptionStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/authenticate';
import {
  createSubscription,
  deleteSubscription,
  getSubscription,
  listSubscriptions,
  updateSubscription,
} from '../services/subscription-service';

const idParamsSchema = z.object({ id: z.string().uuid() });

const eventTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Must be a valid event type.');

const createSubscriptionSchema = z
  .object({
    targetUrl: z.string().url().max(2_048),
    eventTypes: z
      .array(eventTypeSchema)
      .min(1)
      .max(100)
      .transform((types) => [...new Set(types)]),
  })
  .strict();

const updateSubscriptionSchema = z
  .object({
    targetUrl: z.string().url().max(2_048).optional(),
    eventTypes: z
      .array(eventTypeSchema)
      .min(1)
      .max(100)
      .transform((types) => [...new Set(types)])
      .optional(),
    status: z.nativeEnum(SubscriptionStatus).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required.');

const listSubscriptionsQuerySchema = z
  .object({ status: z.nativeEnum(SubscriptionStatus).optional() })
  .strict();

const clientId = (request: { clientId?: string }): string => {
  if (!request.clientId) {
    throw new Error('Authenticated client ID is missing.');
  }

  return request.clientId;
};

export const subscriptionsRouter = Router();

subscriptionsRouter.use(authenticate);

subscriptionsRouter.post('/', async (request, response) => {
  const input = createSubscriptionSchema.parse(request.body);
  const result = await createSubscription(clientId(request), input);

  response.status(201).json({
    subscription: result.subscription,
    secret: result.secret,
  });
});

subscriptionsRouter.get('/', async (request, response) => {
  const { status } = listSubscriptionsQuerySchema.parse(request.query);
  const subscriptions = await listSubscriptions(clientId(request), status);

  response.status(200).json({ subscriptions });
});

subscriptionsRouter.get('/:id', async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const subscription = await getSubscription(clientId(request), id);

  response.status(200).json({ subscription });
});

subscriptionsRouter.patch('/:id', async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  const input = updateSubscriptionSchema.parse(request.body);
  const subscription = await updateSubscription(clientId(request), id, input);

  response.status(200).json({ subscription });
});

subscriptionsRouter.delete('/:id', async (request, response) => {
  const { id } = idParamsSchema.parse(request.params);
  await deleteSubscription(clientId(request), id);

  response.status(204).send();
});
