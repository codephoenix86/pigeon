import type Redis from 'ioredis';

import { env } from '../config/env';
import { logger } from '../config/logger';
import { getRedisClient, closeRedisConnection } from '../config/redis';

const cacheLogger = logger.child({ component: 'subscription-routing-cache' });

const safeRead = async <T>(operation: (redis: Redis) => Promise<T>, fallback: T) => {
  if (!env.SUBSCRIPTION_ROUTING_CACHE_ENABLED) return fallback;
  try {
    return await operation(getRedisClient());
  } catch (err) {
    cacheLogger.warn({ err }, 'Subscription routing cache read failed; falling back to database');
    return fallback;
  }
};

const safeWrite = async (operation: (redis: Redis) => Promise<unknown>, errMsg: string) => {
  if (!env.SUBSCRIPTION_ROUTING_CACHE_ENABLED) return;
  try {
    await operation(getRedisClient());
  } catch (err) {
    cacheLogger.warn({ err }, errMsg);
  }
};

export const getCachedSubscriptionIds = async (clientId: string, eventType: string) => {
  return safeRead(async (redis) => {
    const value = await redis.get(
      `pigeon:subscriptions:${clientId}:${encodeURIComponent(eventType)}`,
    );
    if (!value) return null;

    const ids: unknown = JSON.parse(value);
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      cacheLogger.warn(
        { clientId, eventType },
        'Ignoring malformed subscription routing cache entry',
      );
      return null;
    }

    return ids as string[];
  }, null);
};

export const cacheSubscriptionIds = (clientId: string, eventType: string, ids: string[]) =>
  safeWrite(
    (redis) =>
      redis.set(
        `pigeon:subscriptions:${clientId}:${encodeURIComponent(eventType)}`,
        JSON.stringify(ids),
        'PX',
        env.SUBSCRIPTION_ROUTING_CACHE_TTL_MS,
      ),
    'Subscription routing cache write failed',
  );

export const invalidateSubscriptionRouting = (clientId: string, eventTypes: string[]) => {
  if (eventTypes.length === 0) return;
  return safeWrite(
    (redis) =>
      redis.del(
        [...new Set(eventTypes)].map(
          (type) => `pigeon:subscriptions:${clientId}:${encodeURIComponent(type)}`,
        ),
      ),
    'Subscription routing cache invalidation failed',
  );
};

export const closeSubscriptionRoutingCache = closeRedisConnection;
