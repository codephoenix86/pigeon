import { DeliveryStatus, SubscriptionStatus } from '@prisma/client';
import { DelayedError } from 'bullmq';
import type { Job } from 'bullmq';

import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../db';
import type { DeliveryJobData } from '../queue';
import { calculateDeliveryBackoff } from '../services/delivery-backoff';
import { publishDeadLetterOutboxEntries } from '../services/delivery-dead-letter-outbox-service';
import {
  recordDeliveryPermanentFailure,
  recordDeliveryRetry,
  recordDeliverySuccess,
} from '../services/metrics-service';
import {
  SubscriptionConcurrencyLease,
  tryAcquireSubscriptionLease,
} from '../services/subscription-concurrency-service';
import { createWebhookTimestamp, signWebhookPayload } from '../services/webhook-signature';

const retryDelayByJobId = new Map<string, number>();
const workerLogger = logger.child({ component: 'delivery-worker' });

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
          secret: true,
          status: true,
          targetUrl: true,
        },
      },
    },
  });

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

const postDelivery = async (delivery: LoadedDelivery, deliveryAttemptId: string) => {
  const body = JSON.stringify(delivery.event.payload);
  const timestamp = createWebhookTimestamp();
  const signature = signWebhookPayload(
    body,
    delivery.subscription.secret,
    timestamp,
    deliveryAttemptId,
  );
  const response = await fetch(delivery.subscription.targetUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Delivery-Id': deliveryAttemptId,
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': timestamp,
    },
    body,
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

  recordDeliveryPermanentFailure();

  try {
    await publishDeadLetterOutboxEntries([deliveryAttemptId]);
  } catch (publishError) {
    // Terminal status and DLQ intent are already durable. The background
    // publisher will retry without consuming another webhook attempt.
    workerLogger.error(
      { err: publishError, deliveryAttemptId },
      'Immediate dead-letter outbox publish failed; deferring to retry publisher',
    );
  }

  workerLogger.warn(
    { deliveryAttemptId, attemptsMade, httpStatus, err: error },
    'Webhook delivery permanently failed',
  );
};

export const processDeliveryJob = async (job: Job<DeliveryJobData>) => {
  const jobLogger = workerLogger.child({
    jobId: job.id,
    deliveryAttemptId: job.data.deliveryAttemptId,
  });
  let subscriptionLease: SubscriptionConcurrencyLease | undefined;
  let currentAttemptId: string | undefined;
  let httpStatus: number | null = null;

  try {
    const delivery = await loadDelivery(job.data.deliveryAttemptId);

    // A deleted delivery or disabled subscription makes the queued work stale.
    if (!delivery || delivery.subscription.status !== SubscriptionStatus.ACTIVE) {
      jobLogger.info('Skipping stale webhook delivery job');
      return;
    }

    const subscriptionId = delivery.subscription.id;
    const acquiredLease = await tryAcquireSubscriptionLease(subscriptionId);

    if (!acquiredLease) {
      jobLogger.debug(
        { subscriptionId, delayMs: env.DELIVERY_THROTTLE_DELAY_MS },
        'Delaying webhook delivery because subscription concurrency is exhausted',
      );
      await job.moveToDelayed(Date.now() + env.DELIVERY_THROTTLE_DELAY_MS, job.token);
      throw new DelayedError();
    }

    subscriptionLease = acquiredLease;
    const attemptNumber = job.attemptsMade + 1;
    const attempt = await startDeliveryAttempt(delivery, attemptNumber);
    currentAttemptId = attempt.id;
    httpStatus = await postDelivery(delivery, currentAttemptId);

    await prisma.deliveryAttempt.update({
      where: { id: currentAttemptId },
      data: {
        status: DeliveryStatus.DELIVERED,
        httpStatus,
        nextRetryAt: null,
      },
    });
    recordDeliverySuccess();
    jobLogger.info(
      {
        attemptId: currentAttemptId,
        attemptNumber,
        subscriptionId,
        httpStatus,
      },
      'Webhook delivered',
    );
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
      const nextRetryAt = new Date(Date.now() + retryDelay);

      if (job.id) {
        retryDelayByJobId.set(job.id, retryDelay);
      }

      await prisma.deliveryAttempt.update({
        where: { id: currentAttemptId },
        data: {
          status: DeliveryStatus.RETRY_SCHEDULED,
          httpStatus,
          nextRetryAt,
        },
      });
      recordDeliveryRetry();
      jobLogger.warn(
        {
          err: error,
          attemptId: currentAttemptId,
          attemptNumber: job.attemptsMade + 1,
          httpStatus,
          nextRetryAt,
          retryDelayMs: retryDelay,
        },
        'Webhook delivery failed; retry scheduled',
      );
    }

    throw error;
  } finally {
    if (subscriptionLease) {
      try {
        await subscriptionLease.release();
      } catch (releaseError) {
        // The renewable lease has a TTL, so a failed explicit release cannot
        // hold subscription capacity forever or change the delivery result.
        jobLogger.error({ err: releaseError }, 'Failed to release subscription concurrency lease');
      }
    }
  }
};

export const deliveryBackoffStrategy = (attemptsMade: number, job?: { id?: string }): number => {
  if (job?.id) {
    const recordedDelay = retryDelayByJobId.get(job.id);

    if (recordedDelay !== undefined) {
      retryDelayByJobId.delete(job.id);
      return recordedDelay;
    }
  }

  return calculateDeliveryBackoff(attemptsMade);
};
