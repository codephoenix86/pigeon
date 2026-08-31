import { DeliveryStatus, SubscriptionStatus } from '@prisma/client';
import { DelayedError, Job, Worker } from 'bullmq';

import { env } from '../config/env';
import { prisma } from '../db';
import { DELIVERY_JOB_NAME, DELIVERY_QUEUE_NAME, DeliveryJobData } from '../queue';
import { calculateDeliveryBackoff } from '../services/delivery-backoff';
import { publishDeadLetterOutboxEntries } from '../services/delivery-dead-letter-outbox-service';

const activeDeliveriesBySubscription = new Map<string, number>();
const retryDelayByJobId = new Map<string, number>();

class WebhookResponseError extends Error {
  constructor(readonly httpStatus: number) {
    super(`Webhook endpoint responded with HTTP ${httpStatus}.`);
    this.name = 'WebhookResponseError';
  }
}

const loadDelivery = (deliveryAttemptId: string) =>
  prisma.deliveryAttempt.findUnique({
    where: { id: deliveryAttemptId },
    select: {
      eventId: true,
      subscriptionId: true,
      event: { select: { payload: true } },
      subscription: {
        select: {
          id: true,
          status: true,
          targetUrl: true,
        },
      },
    },
  });

const tryAcquireSubscription = (subscriptionId: string): boolean => {
  const activeCount = activeDeliveriesBySubscription.get(subscriptionId) ?? 0;

  if (activeCount >= env.DELIVERY_SUBSCRIPTION_CONCURRENCY) {
    return false;
  }

  activeDeliveriesBySubscription.set(subscriptionId, activeCount + 1);
  return true;
};

const releaseSubscription = (subscriptionId: string) => {
  const activeCount = activeDeliveriesBySubscription.get(subscriptionId) ?? 0;

  if (activeCount <= 1) {
    activeDeliveriesBySubscription.delete(subscriptionId);
  } else {
    activeDeliveriesBySubscription.set(subscriptionId, activeCount - 1);
  }
};

type LoadedDelivery = NonNullable<Awaited<ReturnType<typeof loadDelivery>>>;

const startDeliveryAttempt = (delivery: LoadedDelivery, attemptNumber: number) =>
  prisma.deliveryAttempt.upsert({
    where: {
      eventId_subscriptionId_attemptNumber: {
        eventId: delivery.eventId,
        subscriptionId: delivery.subscriptionId,
        attemptNumber,
      },
    },
    create: {
      eventId: delivery.eventId,
      subscriptionId: delivery.subscriptionId,
      status: DeliveryStatus.IN_PROGRESS,
      attemptNumber,
    },
    update: {
      status: DeliveryStatus.IN_PROGRESS,
      httpStatus: null,
      nextRetryAt: null,
    },
    select: { id: true },
  });

const postDelivery = async (delivery: LoadedDelivery) => {
  const response = await fetch(delivery.subscription.targetUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(delivery.event.payload),
    redirect: 'manual',
    signal: AbortSignal.timeout(env.DELIVERY_TIMEOUT_MS),
  });

  await response.body?.cancel();

  if (!response.ok) {
    throw new WebhookResponseError(response.status);
  }

  return response.status;
};

const hasExhaustedAttempts = (job: Job<DeliveryJobData>): boolean =>
  job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

const deadLetterDelivery = async (
  deliveryAttemptId: string,
  attemptsMade: number,
  error: unknown,
  httpStatus: number | null,
) => {
  const failedReason = error instanceof Error ? error.message : 'Unknown delivery error.';
  const failedAt = new Date();
  const recorded = await prisma.$transaction(async (transaction) => {
    const update = await transaction.deliveryAttempt.updateMany({
      where: {
        id: deliveryAttemptId,
        status: {
          notIn: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED_PERMANENT],
        },
      },
      data: {
        status: DeliveryStatus.FAILED_PERMANENT,
        httpStatus,
        nextRetryAt: null,
      },
    });

    if (update.count === 0) {
      return false;
    }

    await transaction.deliveryDeadLetterOutbox.createMany({
      data: [
        {
          deliveryAttemptId,
          attemptsMade,
          failedAt,
          failedReason,
        },
      ],
      skipDuplicates: true,
    });

    return true;
  });

  if (!recorded) {
    return;
  }

  try {
    await publishDeadLetterOutboxEntries([deliveryAttemptId]);
  } catch (publishError) {
    // Terminal status and DLQ intent are already durable. The background
    // publisher will retry without consuming another webhook attempt.
    console.error('Immediate dead-letter outbox publish failed; deferring to retry publisher', {
      deliveryAttemptId,
      error: publishError,
    });
  }
};

const processDeliveryJob = async (job: Job<DeliveryJobData>) => {
  let acquiredSubscriptionId: string | undefined;
  let currentAttemptId: string | undefined;
  let httpStatus: number | null = null;

  try {
    const delivery = await loadDelivery(job.data.deliveryAttemptId);

    // A deleted delivery or disabled subscription makes the queued work stale.
    if (!delivery || delivery.subscription.status !== SubscriptionStatus.ACTIVE) {
      return;
    }

    const subscriptionId = delivery.subscription.id;

    if (!tryAcquireSubscription(subscriptionId)) {
      await job.moveToDelayed(Date.now() + env.DELIVERY_THROTTLE_DELAY_MS, job.token);
      throw new DelayedError();
    }

    acquiredSubscriptionId = subscriptionId;
    const attemptNumber = job.attemptsMade + 1;
    const attempt = await startDeliveryAttempt(delivery, attemptNumber);
    currentAttemptId = attempt.id;
    httpStatus = await postDelivery(delivery);

    await prisma.deliveryAttempt.update({
      where: { id: currentAttemptId },
      data: {
        status: DeliveryStatus.DELIVERED,
        httpStatus,
        nextRetryAt: null,
      },
    });
  } catch (error) {
    if (error instanceof DelayedError) {
      throw error;
    }

    if (error instanceof WebhookResponseError) {
      httpStatus = error.httpStatus;
    }

    if (hasExhaustedAttempts(job)) {
      await deadLetterDelivery(
        currentAttemptId ?? job.data.deliveryAttemptId,
        job.attemptsMade + 1,
        error,
        httpStatus,
      );
    } else if (currentAttemptId) {
      const retryDelay = calculateDeliveryBackoff(job.attemptsMade + 1);

      if (job.id) {
        retryDelayByJobId.set(job.id, retryDelay);
      }

      await prisma.deliveryAttempt.update({
        where: { id: currentAttemptId },
        data: {
          status: DeliveryStatus.RETRY_SCHEDULED,
          httpStatus,
          nextRetryAt: new Date(Date.now() + retryDelay),
        },
      });
    }

    throw error;
  } finally {
    if (acquiredSubscriptionId) {
      releaseSubscription(acquiredSubscriptionId);
    }
  }
};

const deliveryBackoffStrategy = (attemptsMade: number, job?: { id?: string }): number => {
  if (job?.id) {
    const recordedDelay = retryDelayByJobId.get(job.id);

    if (recordedDelay !== undefined) {
      retryDelayByJobId.delete(job.id);
      return recordedDelay;
    }
  }

  return calculateDeliveryBackoff(attemptsMade);
};

export const deliveryWorker = new Worker<DeliveryJobData, void, typeof DELIVERY_JOB_NAME>(
  DELIVERY_QUEUE_NAME,
  processDeliveryJob,
  {
    concurrency: env.DELIVERY_WORKER_CONCURRENCY,
    connection: {
      url: env.REDIS_URL,
      // BullMQ requires unlimited command retries for a worker's blocking connection.
      maxRetriesPerRequest: null,
    },
    settings: {
      backoffStrategy: (attemptsMade, _type, _error, job) =>
        deliveryBackoffStrategy(attemptsMade, job),
    },
  },
);
