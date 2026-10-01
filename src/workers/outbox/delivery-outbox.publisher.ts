import { prisma } from '../../config/db';
import { env } from '../../config/env';
import { enqueueDeliveries } from '../../queues/delivery.queue';

export const publishDeliveryOutboxEntries = async () => {
  const entries = await prisma.deliveryAttempt.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: 'asc' },
    take: env.DELIVERY_OUTBOX_BATCH_SIZE,
    select: { id: true },
  });
  const deliveryAttemptIds = entries.map(({ id }) => id);

  await enqueueDeliveries(deliveryAttemptIds);

  if (deliveryAttemptIds.length > 0) {
    await prisma.deliveryAttempt.updateMany({
      where: { id: { in: deliveryAttemptIds }, publishedAt: null },
      data: { publishedAt: new Date() },
    });
  }
};
