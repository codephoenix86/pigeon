import { DeliveryStatus, SubscriptionStatus } from '@prisma/client';
import { Job, Worker } from 'bullmq';

import { env } from '../config/env';
import { prisma } from '../db';
import {
  DELIVERY_JOB_NAME,
  DELIVERY_QUEUE_NAME,
  DeliveryJobData,
  enqueueDeadLetteredDelivery,
} from '../queue';
import { calculateDeliveryBackoff } from '../services/delivery-backoff';

const processDelivery = async (deliveryAttemptId: string) => {
  const delivery = await prisma.deliveryAttempt.findUnique({
    where: { id: deliveryAttemptId },
    select: {
      event: { select: { payload: true } },
      subscription: {
        select: {
          status: true,
          targetUrl: true,
        },
      },
    },
  });

  // A deleted delivery or disabled subscription makes the queued work stale.
  if (!delivery || delivery.subscription.status !== SubscriptionStatus.ACTIVE) {
    return;
  }

  const response = await fetch(delivery.subscription.targetUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(delivery.event.payload),
    redirect: 'manual',
    signal: AbortSignal.timeout(env.DELIVERY_TIMEOUT_MS),
  });

  await response.body?.cancel();

  if (!response.ok) {
    throw new Error(`Webhook endpoint responded with HTTP ${response.status}.`);
  }
};

const hasExhaustedAttempts = (job: Job<DeliveryJobData>): boolean =>
  job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

const deadLetterDelivery = async (
  deliveryAttemptId: string,
  attemptsMade: number,
  error: unknown,
) => {
  const failedReason = error instanceof Error ? error.message : 'Unknown delivery error.';
  const update = await prisma.deliveryAttempt.updateMany({
    where: {
      id: deliveryAttemptId,
      status: { not: DeliveryStatus.DELIVERED },
    },
    data: {
      status: DeliveryStatus.FAILED_PERMANENT,
      nextRetryAt: null,
    },
  });

  if (update.count === 0) {
    return;
  }

  await enqueueDeadLetteredDelivery({
    deliveryAttemptId,
    attemptsMade,
    failedAt: new Date().toISOString(),
    failedReason,
  });
};

const processDeliveryJob = async (job: Job<DeliveryJobData>) => {
  try {
    await processDelivery(job.data.deliveryAttemptId);
  } catch (error) {
    if (hasExhaustedAttempts(job)) {
      await deadLetterDelivery(job.data.deliveryAttemptId, job.attemptsMade + 1, error);
    }

    throw error;
  }
};

export const deliveryWorker = new Worker<DeliveryJobData, void, typeof DELIVERY_JOB_NAME>(
  DELIVERY_QUEUE_NAME,
  processDeliveryJob,
  {
    connection: {
      url: env.REDIS_URL,
      // BullMQ requires unlimited command retries for a worker's blocking connection.
      maxRetriesPerRequest: null,
    },
    settings: {
      backoffStrategy: (attemptsMade) => calculateDeliveryBackoff(attemptsMade),
    },
  },
);
