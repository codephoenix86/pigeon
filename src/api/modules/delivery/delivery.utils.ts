import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../../../config/env';

const retryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000] as const;

export const calculateDeliveryBackoff = (
  attemptsMade: number,
  jitterValue = Math.random(),
  jitterRatio = env.DELIVERY_BACKOFF_JITTER,
): number => {
  const retryIndex = Math.min(Math.max(attemptsMade - 1, 0), retryDelaysMs.length - 1);
  const baseDelay = retryDelaysMs[retryIndex];
  const boundedJitterValue = Math.min(Math.max(jitterValue, 0), 1);
  return Math.round(baseDelay * (1 - jitterRatio + 2 * jitterRatio * boundedJitterValue));
};

export const createWebhookTimestamp = (date = new Date()): string =>
  Math.floor(date.getTime() / 1_000).toString();

export const signWebhookPayload = (
  payload: string,
  secret: string,
  timestamp: string,
  deliveryId: string,
): string =>
  `sha256=${createHmac('sha256', secret).update(timestamp, 'utf8').update('.', 'utf8').update(deliveryId, 'utf8').update('.', 'utf8').update(payload, 'utf8').digest('hex')}`;

export const verifyWebhookSignature = (
  payload: string,
  secret: string,
  timestamp: string,
  deliveryId: string,
  signature: string,
): boolean => {
  const expectedSignature = Buffer.from(
    signWebhookPayload(payload, secret, timestamp, deliveryId),
    'utf8',
  );
  const providedSignature = Buffer.from(signature, 'utf8');
  return (
    expectedSignature.length === providedSignature.length &&
    timingSafeEqual(expectedSignature, providedSignature)
  );
};
