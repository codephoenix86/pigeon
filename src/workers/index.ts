import { SubscriptionStatus } from '@prisma/client';
import { Worker } from 'bullmq';

import { env } from '../config/env';
import { prisma } from '../db';
import { DELIVERY_JOB_NAME, DELIVERY_QUEUE_NAME, DeliveryJobData } from '../queue';

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

export const deliveryWorker = new Worker<DeliveryJobData, void, typeof DELIVERY_JOB_NAME>(
  DELIVERY_QUEUE_NAME,
  (job) => processDelivery(job.data.deliveryAttemptId),
  {
    connection: {
      url: env.REDIS_URL,
      // BullMQ requires unlimited command retries for a worker's blocking connection.
      maxRetriesPerRequest: null,
    },
  },
);
