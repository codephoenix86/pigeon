import { Prisma } from '@prisma/client';

import { prisma } from '../../../config/db';
import { AppError } from '../../common/errors';

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
  fanoutStatus: true,
  createdAt: true,
} as const;

export const createEvent = async (clientId: string, input: CreateEventInput) => {
  const event = await prisma.event.create({
    data: { ...input, clientId },
    select: eventFields,
  });

  return { event };
};

export const listEventDeliveries = async (clientId: string, eventId: string) => {
  const event = await prisma.event.findFirst({
    where: { id: eventId, clientId },
    select: { id: true },
  });

  if (!event) {
    throw new AppError('Event not found.', 404, { code: 'NOT_FOUND' });
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
