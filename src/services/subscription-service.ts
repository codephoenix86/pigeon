import { randomBytes } from 'node:crypto';

import { SubscriptionStatus } from '@prisma/client';

import { prisma } from '../db';
import { AppError } from '../errors/app-error';
import { invalidateSubscriptionRouting } from './subscription-routing-cache-service';
import { validateWebhookTargetUrl } from './webhook-target-validator';

const subscriptionFields = {
  id: true,
  targetUrl: true,
  eventTypes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CreateSubscriptionInput = {
  targetUrl: string;
  eventTypes: string[];
};

export type UpdateSubscriptionInput = Partial<
  CreateSubscriptionInput & { status: SubscriptionStatus }
>;

const findOwnedSubscriptionOrThrow = async (clientId: string, id: string) => {
  const subscription = await prisma.subscription.findFirst({
    where: { id, clientId },
    select: subscriptionFields,
  });

  if (!subscription) {
    throw new AppError(404, 'NOT_FOUND', 'Subscription not found.');
  }

  return subscription;
};

export const createSubscription = async (clientId: string, input: CreateSubscriptionInput) => {
  const targetUrl = await validateWebhookTargetUrl(input.targetUrl);
  const secret = randomBytes(32).toString('base64url');
  const subscription = await prisma.subscription.create({
    data: { ...input, targetUrl, clientId, secret },
    select: subscriptionFields,
  });

  await invalidateSubscriptionRouting(clientId, subscription.eventTypes);

  return { subscription, secret };
};

export const listSubscriptions = (clientId: string, status?: SubscriptionStatus) =>
  prisma.subscription.findMany({
    where: { clientId, ...(status ? { status } : {}) },
    select: subscriptionFields,
    orderBy: { createdAt: 'desc' },
  });

export const getSubscription = (clientId: string, id: string) =>
  findOwnedSubscriptionOrThrow(clientId, id);

export const updateSubscription = async (
  clientId: string,
  id: string,
  input: UpdateSubscriptionInput,
) => {
  const existing = await findOwnedSubscriptionOrThrow(clientId, id);
  const data = input.targetUrl
    ? { ...input, targetUrl: await validateWebhookTargetUrl(input.targetUrl) }
    : input;

  const subscription = await prisma.subscription.update({
    where: { id },
    data,
    select: subscriptionFields,
  });

  if ('eventTypes' in input || 'status' in input) {
    await invalidateSubscriptionRouting(clientId, [...existing.eventTypes, ...subscription.eventTypes]);
  }

  return subscription;
};

/**
 * Disabling retains delivery history and makes queued work ineligible for future
 * delivery, matching the dispatcher lifecycle semantics.
 */
export const deleteSubscription = async (clientId: string, id: string) => {
  const subscription = await findOwnedSubscriptionOrThrow(clientId, id);
  await prisma.subscription.update({
    where: { id },
    data: { status: SubscriptionStatus.DISABLED },
  });
  await invalidateSubscriptionRouting(clientId, subscription.eventTypes);
};
