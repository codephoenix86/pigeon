import { Queue } from 'bullmq';

import { env } from '../config/env';
import { DELIVERY_BACKOFF_STRATEGY } from '../services/delivery-backoff';

export const DELIVERY_QUEUE_NAME = 'webhook-deliveries';
export const DELIVERY_JOB_NAME = 'deliver-webhook';

export type DeliveryJobData = {
  deliveryAttemptId: string;
};

export const deliveryQueue = new Queue<DeliveryJobData, void, typeof DELIVERY_JOB_NAME>(
  DELIVERY_QUEUE_NAME,
  {
    connection: {
      url: env.REDIS_URL,
      // API requests should fail promptly when Redis is unavailable instead of
      // waiting indefinitely for a command to be retried.
      maxRetriesPerRequest: 1,
    },
  },
);

export const enqueueDeliveries = async (deliveryAttemptIds: string[]) => {
  if (deliveryAttemptIds.length === 0) {
    return;
  }

  await deliveryQueue.addBulk(
    deliveryAttemptIds.map((deliveryAttemptId) => ({
      name: DELIVERY_JOB_NAME,
      data: { deliveryAttemptId },
      opts: {
        jobId: deliveryAttemptId,
        attempts: env.DELIVERY_MAX_ATTEMPTS,
        backoff: { type: DELIVERY_BACKOFF_STRATEGY },
      },
    })),
  );
};
