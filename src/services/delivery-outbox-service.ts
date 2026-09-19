import { DeliveryStatus } from '@prisma/client';

import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../db';
import { enqueueDeliveries } from '../queue';

const outboxLogger = logger.child({ component: 'delivery-outbox-publisher' });

const publishOutboxBatch = async (deliveryAttemptIds?: string[]): Promise<number> => {
  const entries = await prisma.deliveryAttempt.findMany({
    where: {
      status: DeliveryStatus.PENDING,
      publishedAt: null,
      ...(deliveryAttemptIds ? { id: { in: deliveryAttemptIds } } : {}),
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: env.DELIVERY_OUTBOX_BATCH_SIZE,
  });

  if (entries.length === 0) {
    return 0;
  }

  const unpublishedDeliveryAttemptIds = entries.map((entry) => entry.id);

  // Queue job IDs are delivery-attempt IDs. If a publisher crashes after Redis
  // accepts these jobs but before PostgreSQL is updated, the next pass safely
  // republishes the same IDs rather than creating duplicate jobs.
  await enqueueDeliveries(unpublishedDeliveryAttemptIds);

  const published = await prisma.deliveryAttempt.updateMany({
    where: {
      id: { in: unpublishedDeliveryAttemptIds },
      publishedAt: null,
    },
    data: { publishedAt: new Date() },
  });

  return published.count;
};

export const publishDeliveryOutboxEntries = async (
  deliveryAttemptIds: string[],
): Promise<number> => {
  let publishedCount = 0;

  for (let index = 0; index < deliveryAttemptIds.length; index += env.DELIVERY_OUTBOX_BATCH_SIZE) {
    const batchDeliveryAttemptIds = deliveryAttemptIds.slice(
      index,
      index + env.DELIVERY_OUTBOX_BATCH_SIZE,
    );
    publishedCount += await publishOutboxBatch(batchDeliveryAttemptIds);
  }

  return publishedCount;
};

let publisherTimer: NodeJS.Timeout | undefined;
let publishInFlight: Promise<void> | undefined;

const pollDeliveryOutbox = () => {
  if (publishInFlight) {
    return;
  }

  publishInFlight = publishOutboxBatch()
    .then(() => undefined)
    .catch((error: unknown) => {
      outboxLogger.error({ err: error }, 'Delivery outbox publish failed; will retry');
    })
    .finally(() => {
      publishInFlight = undefined;
    });
};

export const startDeliveryOutboxPublisher = () => {
  if (publisherTimer) {
    return;
  }

  pollDeliveryOutbox();
  publisherTimer = setInterval(pollDeliveryOutbox, env.DELIVERY_OUTBOX_POLL_INTERVAL_MS);
};

export const stopDeliveryOutboxPublisher = async () => {
  if (publisherTimer) {
    clearInterval(publisherTimer);
    publisherTimer = undefined;
  }

  await publishInFlight;
};
