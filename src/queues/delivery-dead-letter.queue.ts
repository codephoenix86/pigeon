import { Queue } from 'bullmq';

import { env } from '../config/env';
import {
  DELIVERY_DEAD_LETTER_JOB_NAME,
  DELIVERY_DEAD_LETTER_QUEUE_NAME,
  type DeliveryDeadLetterJobData,
} from '../api/modules/delivery/delivery.constants';

const producerConnection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: 1,
};

export const deliveryDeadLetterQueue = new Queue<
  DeliveryDeadLetterJobData,
  void,
  typeof DELIVERY_DEAD_LETTER_JOB_NAME
>(DELIVERY_DEAD_LETTER_QUEUE_NAME, { connection: producerConnection });

export const enqueueDeadLetteredDeliveries = async (entries: DeliveryDeadLetterJobData[]) => {
  if (entries.length === 0) {
    return;
  }

  await deliveryDeadLetterQueue.addBulk(
    entries.map((data) => ({
      name: DELIVERY_DEAD_LETTER_JOB_NAME,
      data,
      opts: { jobId: data.deliveryAttemptId },
    })),
  );
};
