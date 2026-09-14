import { createHmac, timingSafeEqual } from 'node:crypto';

export const createWebhookTimestamp = (date = new Date()): string =>
  Math.floor(date.getTime() / 1_000).toString();

export const signWebhookPayload = (
  payload: string,
  secret: string,
  timestamp: string,
  deliveryId: string,
): string =>
  `sha256=${createHmac('sha256', secret)
    .update(timestamp, 'utf8')
    .update('.', 'utf8')
    .update(deliveryId, 'utf8')
    .update('.', 'utf8')
    .update(payload, 'utf8')
    .digest('hex')}`;

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
