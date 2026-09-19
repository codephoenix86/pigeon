import Redis from 'ioredis';

import { env } from '../config/env';
import { logger } from '../config/logger';

const cacheLogger = logger.child({ component: 'subscription-routing-cache' });
const ROUTING_KEY_PREFIX = 'pigeon:subscriptions:';

// This connection is deliberately separate from BullMQ's connections. Routing
// cache failures must never affect queue processing or durable fan-out.
const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});

redis.on('error', (error) => {
  cacheLogger.warn({ err: error }, 'Subscription routing cache Redis error; bypassing cache');
});

let connectionInFlight: Promise<void> | undefined;

const ensureConnected = async () => {
  if (redis.status === 'ready') return;

  if (!connectionInFlight) {
    connectionInFlight = redis.connect().finally(() => {
      connectionInFlight = undefined;
    });
  }

  await connectionInFlight;
};

const routingKey = (clientId: string, eventType: string) =>
  `${ROUTING_KEY_PREFIX}${clientId}:${encodeURIComponent(eventType)}`;

/** Returns null for a miss or any Redis failure, allowing PostgreSQL fallback. */
export const getCachedSubscriptionIds = async (
  clientId: string,
  eventType: string,
): Promise<string[] | null> => {
  if (!env.SUBSCRIPTION_ROUTING_CACHE_ENABLED) return null;

  try {
    await ensureConnected();
    const value = await redis.get(routingKey(clientId, eventType));
    if (value === null) return null;

    const ids: unknown = JSON.parse(value);
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      cacheLogger.warn({ clientId, eventType }, 'Ignoring malformed subscription routing cache entry');
      return null;
    }

    return ids;
  } catch (error) {
    cacheLogger.warn({ err: error }, 'Subscription routing cache read failed; falling back to database');
    return null;
  }
};

export const cacheSubscriptionIds = async (
  clientId: string,
  eventType: string,
  subscriptionIds: string[],
): Promise<void> => {
  if (!env.SUBSCRIPTION_ROUTING_CACHE_ENABLED) return;

  try {
    await ensureConnected();
    await redis.set(
      routingKey(clientId, eventType),
      JSON.stringify(subscriptionIds),
      'PX',
      env.SUBSCRIPTION_ROUTING_CACHE_TTL_MS,
    );
  } catch (error) {
    cacheLogger.warn({ err: error }, 'Subscription routing cache write failed');
  }
};

/** Best-effort invalidation after a committed subscription mutation. */
export const invalidateSubscriptionRouting = async (clientId: string, eventTypes: string[]) => {
  if (!env.SUBSCRIPTION_ROUTING_CACHE_ENABLED || eventTypes.length === 0) return;

  try {
    await ensureConnected();
    await redis.del([...new Set(eventTypes)].map((eventType) => routingKey(clientId, eventType)));
  } catch (error) {
    cacheLogger.warn({ err: error }, 'Subscription routing cache invalidation failed');
  }
};

export const closeSubscriptionRoutingCache = async () => {
  if (redis.status === 'wait' || redis.status === 'end') return;
  if (redis.status === 'ready') {
    await redis.quit();
    return;
  }
  redis.disconnect();
};
