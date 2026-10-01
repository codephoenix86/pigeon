import { Queue } from 'bullmq';

import { env } from '../config/env';
import {
  DELIVERY_BACKOFF_STRATEGY,
  DELIVERY_JOB_NAME,
  DELIVERY_QUEUE_NAME,
  type DeliveryJobData,
} from '../api/modules/delivery/delivery.constants';

const producerConnection = {
  url: env.REDIS_URL,
  // Publishers should fail promptly when Redis is unavailable rather than
  // retaining commands indefinitely in memory.
  maxRetriesPerRequest: 1,
};

export const deliveryQueue = new Queue<DeliveryJobData, void, typeof DELIVERY_JOB_NAME>(
  DELIVERY_QUEUE_NAME,
  { connection: producerConnection },
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
