import { env } from '../config/env';

export const DELIVERY_BACKOFF_STRATEGY = 'delivery-exponential';

const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

export const calculateDeliveryBackoff = (
  attemptsMade: number,
  jitterValue = Math.random(),
): number => {
  const retryIndex = Math.min(Math.max(attemptsMade - 1, 0), RETRY_DELAYS_MS.length - 1);
  const baseDelay = RETRY_DELAYS_MS[retryIndex];
  const boundedJitterValue = Math.min(Math.max(jitterValue, 0), 1);
  const jitterMultiplier =
    1 - env.DELIVERY_BACKOFF_JITTER + 2 * env.DELIVERY_BACKOFF_JITTER * boundedJitterValue;

  return Math.round(baseDelay * jitterMultiplier);
};
