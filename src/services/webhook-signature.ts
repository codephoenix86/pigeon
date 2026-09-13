import { createHmac } from 'node:crypto';

export const createWebhookTimestamp = (date = new Date()): string =>
  Math.floor(date.getTime() / 1_000).toString();

export const signWebhookPayload = (payload: string, secret: string, timestamp: string): string =>
  `sha256=${createHmac('sha256', secret)
    .update(timestamp, 'utf8')
    .update('.', 'utf8')
    .update(payload, 'utf8')
    .digest('hex')}`;
