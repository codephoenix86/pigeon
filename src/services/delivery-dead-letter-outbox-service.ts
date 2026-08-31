import { env } from '../config/env';
import { prisma } from '../db';
import { enqueueDeadLetteredDeliveries } from '../queue';

const publishDeadLetterOutboxBatch = async (deliveryAttemptIds?: string[]): Promise<number> => {
  const entries = await prisma.deliveryDeadLetterOutbox.findMany({
    where: {
      publishedAt: null,
      ...(deliveryAttemptIds ? { deliveryAttemptId: { in: deliveryAttemptIds } } : {}),
    },
    select: {
      deliveryAttemptId: true,
      attemptsMade: true,
      failedAt: true,
      failedReason: true,
    },
    orderBy: { failedAt: 'asc' },
    take: env.DELIVERY_OUTBOX_BATCH_SIZE,
  });

  if (entries.length === 0) {
    return 0;
  }

  await enqueueDeadLetteredDeliveries(
    entries.map((entry) => ({
      deliveryAttemptId: entry.deliveryAttemptId,
      attemptsMade: entry.attemptsMade,
      failedAt: entry.failedAt.toISOString(),
      failedReason: entry.failedReason,
    })),
  );

  const published = await prisma.deliveryDeadLetterOutbox.updateMany({
    where: {
      deliveryAttemptId: { in: entries.map((entry) => entry.deliveryAttemptId) },
      publishedAt: null,
    },
    data: { publishedAt: new Date() },
  });

  return published.count;
};

export const publishDeadLetterOutboxEntries = async (
  deliveryAttemptIds: string[],
): Promise<number> => {
  let publishedCount = 0;

  for (let index = 0; index < deliveryAttemptIds.length; index += env.DELIVERY_OUTBOX_BATCH_SIZE) {
    const batchDeliveryAttemptIds = deliveryAttemptIds.slice(
      index,
      index + env.DELIVERY_OUTBOX_BATCH_SIZE,
    );
    publishedCount += await publishDeadLetterOutboxBatch(batchDeliveryAttemptIds);
  }

  return publishedCount;
};

let publisherTimer: NodeJS.Timeout | undefined;
let publishInFlight: Promise<void> | undefined;

const pollDeadLetterOutbox = () => {
  if (publishInFlight) {
    return;
  }

  publishInFlight = publishDeadLetterOutboxBatch()
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error('Delivery dead-letter outbox publish failed; will retry', error);
    })
    .finally(() => {
      publishInFlight = undefined;
    });
};

export const startDeadLetterOutboxPublisher = () => {
  if (publisherTimer) {
    return;
  }

  pollDeadLetterOutbox();
  publisherTimer = setInterval(pollDeadLetterOutbox, env.DELIVERY_OUTBOX_POLL_INTERVAL_MS);
};

export const stopDeadLetterOutboxPublisher = async () => {
  if (publisherTimer) {
    clearInterval(publisherTimer);
    publisherTimer = undefined;
  }

  await publishInFlight;
};
