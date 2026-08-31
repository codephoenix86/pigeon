import { Queue } from 'bullmq';

import { env } from '../config/env';

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
