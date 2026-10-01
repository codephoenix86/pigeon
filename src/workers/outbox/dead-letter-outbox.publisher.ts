import { prisma } from '../../config/db';
import { env } from '../../config/env';
import { enqueueDeadLetteredDeliveries } from '../../queues/delivery-dead-letter.queue';

export const publishDeadLetterOutboxEntries = async (deliveryAttemptIds?: string[]) => {
  const entries = await prisma.deliveryDeadLetterOutbox.findMany({
    where: {
      publishedAt: null,
      ...(deliveryAttemptIds ? { deliveryAttemptId: { in: deliveryAttemptIds } } : {}),
    },
    orderBy: { failedAt: 'asc' },
    take: env.DELIVERY_OUTBOX_BATCH_SIZE,
    select: {
      deliveryAttemptId: true,
      attemptsMade: true,
      failedAt: true,
      failedReason: true,
    },
  });

  await enqueueDeadLetteredDeliveries(
    entries.map((entry) => ({
      deliveryAttemptId: entry.deliveryAttemptId,
      attemptsMade: entry.attemptsMade,
      failedAt: entry.failedAt.toISOString(),
      failedReason: entry.failedReason,
    })),
  );

  const ids = entries.map(({ deliveryAttemptId }) => deliveryAttemptId);
  if (ids.length > 0) {
    await prisma.deliveryDeadLetterOutbox.updateMany({
      where: { deliveryAttemptId: { in: ids }, publishedAt: null },
      data: { publishedAt: new Date() },
    });
  }
};
