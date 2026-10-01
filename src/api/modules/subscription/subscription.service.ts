import { randomBytes } from 'node:crypto';

import { SubscriptionStatus } from '@prisma/client';

import { prisma } from '../../../config/db';
import { AppError } from '../../common/errors';
import { validateWebhookTargetUrl } from './subscription.utils';
import { invalidateSubscriptionRouting } from '../../../cache';

const subscriptionFields = {
  id: true,
  targetUrl: true,
  eventTypes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CreateSubscriptionInput = { targetUrl: string; eventTypes: string[] };
export type UpdateSubscriptionInput = Partial<
  CreateSubscriptionInput & { status: SubscriptionStatus }
>;

const findOwnedSubscriptionOrThrow = async (clientId: string, id: string) => {
  const subscription = await prisma.subscription.findFirst({
    where: { id, clientId },
    select: subscriptionFields,
  });

  if (!subscription) throw new AppError('Subscription not found.', 404, { code: 'NOT_FOUND' });
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
    await invalidateSubscriptionRouting(clientId, [
      ...existing.eventTypes,
      ...subscription.eventTypes,
    ]);
  }

  return subscription;
};

export const deleteSubscription = async (clientId: string, id: string) => {
  const subscription = await findOwnedSubscriptionOrThrow(clientId, id);
  await prisma.subscription.update({
    where: { id },
    data: { status: SubscriptionStatus.DISABLED },
  });
  await invalidateSubscriptionRouting(clientId, subscription.eventTypes);
};
