import Redis from 'ioredis';

import { env } from '../config/env';
import { logger } from '../config/logger';

const cacheLogger = logger.child({ component: 'api-key-cache' });
const AUTHENTICATED_CLIENT_KEY_PREFIX = 'pigeon:auth:client:';
const INVALID_API_KEY_PREFIX = 'pigeon:auth:invalid:';

// The connection is lazy so one-off commands such as `client:create` do not
// open a Redis connection merely by importing the client service.
const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});

redis.on('error', (error) => {
  cacheLogger.warn({ err: error }, 'API key cache Redis error; bypassing cache');
});

let connectionInFlight: Promise<void> | undefined;

const ensureConnected = async () => {
  if (redis.status === 'ready') {
    return;
  }

  if (!connectionInFlight) {
    connectionInFlight = redis.connect().finally(() => {
      connectionInFlight = undefined;
    });
  }

  await connectionInFlight;
};

const fromCache = async (operation: () => Promise<string | null>): Promise<string | null> => {
  try {
    await ensureConnected();
    return await operation();
  } catch (error) {
    cacheLogger.warn({ err: error }, 'API key cache read failed; falling back to database');
    return null;
  }
};

const writeCache = async (operation: () => Promise<unknown>): Promise<void> => {
  try {
    await ensureConnected();
    await operation();
  } catch (error) {
    // Authentication remains available when Redis is unavailable. PostgreSQL is
    // still the source of truth and every cache write is best effort.
    cacheLogger.warn({ err: error }, 'API key cache write failed');
  }
};

const clientKey = (apiKeyHash: string) => `${AUTHENTICATED_CLIENT_KEY_PREFIX}${apiKeyHash}`;
const invalidKey = (apiKeyHash: string) => `${INVALID_API_KEY_PREFIX}${apiKeyHash}`;

export const getCachedAuthenticatedClientId = (apiKeyHash: string) =>
  fromCache(() => redis.get(clientKey(apiKeyHash)));

export const isKnownInvalidApiKey = async (apiKeyHash: string): Promise<boolean> =>
  (await fromCache(() => redis.get(invalidKey(apiKeyHash)))) === '1';

export const cacheAuthenticatedClient = (apiKeyHash: string, clientId: string) =>
  writeCache(() => redis.set(clientKey(apiKeyHash), clientId, 'PX', env.API_KEY_CACHE_TTL_MS));

export const cacheInvalidApiKey = (apiKeyHash: string) =>
  writeCache(() => redis.set(invalidKey(apiKeyHash), '1', 'PX', env.API_KEY_NEGATIVE_CACHE_TTL_MS));

export const closeApiKeyCache = async () => {
  if (redis.status === 'wait' || redis.status === 'end') {
    return;
  }

  if (redis.status === 'ready') {
    await redis.quit();
    return;
  }

  redis.disconnect();
};
