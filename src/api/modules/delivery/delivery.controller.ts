import type { RequestHandler } from 'express';
import { z } from 'zod';

import { prisma } from '../../../config/db';

export const listFailedDeliveriesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

const clientId = (request: { clientId?: string }): string => {
  if (!request.clientId) throw new Error('Authenticated client ID is missing.');
  return request.clientId;
};

export const listFailedDeliveriesController: RequestHandler = async (request, response) => {
  const { limit, offset } = listFailedDeliveriesQuerySchema.parse(request.query);
  const records = await prisma.deliveryDeadLetterOutbox.findMany({
    where: {
      deliveryAttempt: {
        event: { clientId: clientId(request) },
        subscription: { clientId: clientId(request) },
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
          event: { select: { id: true, type: true, source: true, createdAt: true } },
          subscription: { select: { id: true, targetUrl: true, status: true } },
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
  response.status(200).json({
    deliveries,
    pagination: { limit, offset, nextOffset: hasMore ? offset + limit : null },
  });
};
