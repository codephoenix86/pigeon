import { DeliveryStatus, Prisma, SubscriptionStatus } from '@prisma/client';

import { prisma } from '../db';
import { AppError } from '../errors/app-error';

export type CreateEventInput = {
  type: string;
  payload: Prisma.InputJsonValue;
  source?: string;
};

const eventFields = {
  id: true,
  type: true,
  payload: true,
  source: true,
  createdAt: true,
} as const;

export const createEvent = async (clientId: string, input: CreateEventInput) =>
  prisma.$transaction(async (transaction) => {
    const event = await transaction.event.create({
      data: { ...input, clientId },
      select: eventFields,
    });
    const subscriptions = await transaction.subscription.findMany({
      where: {
        clientId,
        status: SubscriptionStatus.ACTIVE,
        eventTypes: { has: input.type },
      },
      select: { id: true },
    });

    if (subscriptions.length > 0) {
      await transaction.deliveryAttempt.createMany({
        data: subscriptions.map((subscription) => ({
          eventId: event.id,
          subscriptionId: subscription.id,
          status: DeliveryStatus.PENDING,
          attemptNumber: 1,
        })),
      });
    }

    return { event, deliveryCount: subscriptions.length };
  });

export const listEventDeliveries = async (clientId: string, eventId: string) => {
  const event = await prisma.event.findFirst({
    where: { id: eventId, clientId },
    select: { id: true },
  });

  if (!event) {
    throw new AppError(404, 'NOT_FOUND', 'Event not found.');
  }

  return prisma.deliveryAttempt.findMany({
    where: { eventId },
    select: {
      id: true,
      subscriptionId: true,
      status: true,
      httpStatus: true,
      attemptNumber: true,
      nextRetryAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { attemptNumber: 'asc' }],
  });
};
