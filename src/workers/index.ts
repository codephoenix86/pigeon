import { Worker } from 'bullmq';

import { env } from '../config/env';
import { DELIVERY_JOB_NAME, DELIVERY_QUEUE_NAME, DeliveryJobData } from '../queue';
import { deliveryBackoffStrategy, processDeliveryJob } from './delivery-processor';

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
