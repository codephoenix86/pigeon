export const DELIVERY_BACKOFF_STRATEGY = 'delivery-exponential';
export const DELIVERY_QUEUE_NAME = 'webhook-deliveries';
export const DELIVERY_JOB_NAME = 'deliver-webhook';
export const DELIVERY_DEAD_LETTER_QUEUE_NAME = 'webhook-deliveries-dlq';
export const DELIVERY_DEAD_LETTER_JOB_NAME = 'dead-lettered-delivery';

export type DeliveryJobData = { deliveryAttemptId: string };
export type DeliveryDeadLetterJobData = DeliveryJobData & {
  attemptsMade: number;
  failedAt: string;
  failedReason: string;
};
