import { createHmac } from 'node:crypto';

export const signWebhookPayload = (payload: string, secret: string): string =>
  `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`;
