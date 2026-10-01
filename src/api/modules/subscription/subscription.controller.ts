import type { RequestHandler } from 'express';

import {
  createSubscriptionSchema,
  listSubscriptionsQuerySchema,
  subscriptionIdParamsSchema,
  updateSubscriptionSchema,
} from './subscription.schema';
import {
  createSubscription,
  deleteSubscription,
  getSubscription,
  listSubscriptions,
  updateSubscription,
} from './subscription.service';

const clientId = (request: { clientId?: string }): string => {
  if (!request.clientId) {
    throw new Error('Authenticated client ID is missing.');
  }

  return request.clientId;
};

export const createSubscriptionController: RequestHandler = async (request, response) => {
  const input = createSubscriptionSchema.parse(request.body);
  const result = await createSubscription(clientId(request), input);

  response.status(201).json({
    subscription: result.subscription,
    secret: result.secret,
  });
};

export const listSubscriptionsController: RequestHandler = async (request, response) => {
  const { status } = listSubscriptionsQuerySchema.parse(request.query);
  const subscriptions = await listSubscriptions(clientId(request), status);

  response.status(200).json({ subscriptions });
};

export const getSubscriptionController: RequestHandler = async (request, response) => {
  const { id } = subscriptionIdParamsSchema.parse(request.params);
  const subscription = await getSubscription(clientId(request), id);

  response.status(200).json({ subscription });
};

export const updateSubscriptionController: RequestHandler = async (request, response) => {
  const { id } = subscriptionIdParamsSchema.parse(request.params);
  const input = updateSubscriptionSchema.parse(request.body);
  const subscription = await updateSubscription(clientId(request), id, input);

  response.status(200).json({ subscription });
};

export const deleteSubscriptionController: RequestHandler = async (request, response) => {
  const { id } = subscriptionIdParamsSchema.parse(request.params);
  await deleteSubscription(clientId(request), id);

  response.status(204).send();
};
