import { randomBytes } from 'node:crypto';

import { SubscriptionStatus } from '@prisma/client';

import { prisma } from '../db';
import { AppError } from '../errors/app-error';

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
  const secret = randomBytes(32).toString('base64url');
  const subscription = await prisma.subscription.create({
    data: { ...input, clientId, secret },
    select: subscriptionFields,
  });

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
  await findOwnedSubscriptionOrThrow(clientId, id);

  return prisma.subscription.update({
    where: { id },
    data: input,
    select: subscriptionFields,
  });
};

/**
 * Disabling retains delivery history and makes queued work ineligible for future
 * delivery, matching the dispatcher lifecycle semantics.
 */
export const deleteSubscription = async (clientId: string, id: string) => {
  await findOwnedSubscriptionOrThrow(clientId, id);
  await prisma.subscription.update({
    where: { id },
    data: { status: SubscriptionStatus.DISABLED },
  });
};
