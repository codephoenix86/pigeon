import { DeliveryStatus, Prisma, SubscriptionStatus } from '@prisma/client';

import { prisma } from '../db';
import { AppError } from '../errors/app-error';
import { publishDeliveryOutboxEntries } from './delivery-outbox-service';

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

export const createEvent = async (clientId: string, input: CreateEventInput) => {
  const { event, deliveryAttemptIds } = await prisma.$transaction(async (transaction) => {
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

    const deliveryAttempts = await transaction.deliveryAttempt.createManyAndReturn({
      data: subscriptions.map((subscription) => ({
        eventId: event.id,
        subscriptionId: subscription.id,
        status: DeliveryStatus.PENDING,
        attemptNumber: 1,
      })),
      select: { id: true },
    });

    if (deliveryAttempts.length > 0) {
      await transaction.deliveryOutbox.createMany({
        data: deliveryAttempts.map((deliveryAttempt) => ({
          deliveryAttemptId: deliveryAttempt.id,
        })),
      });
    }

    return {
      event,
      deliveryAttemptIds: deliveryAttempts.map((deliveryAttempt) => deliveryAttempt.id),
    };
  });

  try {
    await publishDeliveryOutboxEntries(deliveryAttemptIds);
  } catch (error) {
    // The enqueue intent is durable. The background publisher will retry it,
    // so a temporary Redis outage must not turn an accepted event into a 500.
    console.error('Immediate delivery outbox publish failed; deferring to retry publisher', error);
  }

  return { event, deliveryCount: deliveryAttemptIds.length };
};

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
