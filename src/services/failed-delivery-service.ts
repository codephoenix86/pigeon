import { prisma } from '../db';

export type ListFailedDeliveriesInput = {
  limit: number;
  offset: number;
};

export const listFailedDeliveries = async (
  clientId: string,
  { limit, offset }: ListFailedDeliveriesInput,
) => {
  const records = await prisma.deliveryDeadLetterOutbox.findMany({
    where: {
      deliveryAttempt: {
        event: { clientId },
        subscription: { clientId },
      },
    },
    select: {
      attemptsMade: true,
      failedReason: true,
      failedAt: true,
      publishedAt: true,
      deliveryAttempt: {
        select: {
          id: true,
          status: true,
          httpStatus: true,
          attemptNumber: true,
          createdAt: true,
          updatedAt: true,
          event: {
            select: {
              id: true,
              type: true,
              source: true,
              createdAt: true,
            },
          },
          subscription: {
            select: {
              id: true,
              targetUrl: true,
              status: true,
            },
          },
        },
      },
    },
    orderBy: [{ failedAt: 'desc' }, { deliveryAttemptId: 'desc' }],
    skip: offset,
    take: limit + 1,
  });

  const hasMore = records.length > limit;
  const deliveries = records.slice(0, limit).map(({ deliveryAttempt, ...deadLetter }) => ({
    ...deliveryAttempt,
    attemptsMade: deadLetter.attemptsMade,
    failedReason: deadLetter.failedReason,
    failedAt: deadLetter.failedAt,
    deadLetterPublishedAt: deadLetter.publishedAt,
  }));

  return {
    deliveries,
    pagination: {
      limit,
      offset,
      nextOffset: hasMore ? offset + limit : null,
    },
  };
};
