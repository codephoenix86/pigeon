import type Redis from 'ioredis';

import { env } from '../config/env';
import { logger } from '../config/logger';
import { getRedisClient, closeRedisConnection } from '../config/redis';

const cacheLogger = logger.child({ component: 'api-key-cache' });

const safeRead = async (operation: (redis: Redis) => Promise<string | null>) => {
  try {
    return await operation(getRedisClient());
  } catch (err) {
    cacheLogger.warn({ err }, 'API key cache read failed; falling back to database');
    return null;
  }
};

const safeWrite = async (operation: (redis: Redis) => Promise<unknown>) => {
  try {
    await operation(getRedisClient());
  } catch (err) {
    cacheLogger.warn({ err }, 'API key cache write failed');
  }
};

export const getCachedAuthenticatedClientId = (hash: string) =>
  safeRead((redis) => redis.get(`pigeon:auth:client:${hash}`));

export const isKnownInvalidApiKey = async (hash: string) =>
  (await safeRead((redis) => redis.get(`pigeon:auth:invalid:${hash}`))) === '1';

export const cacheAuthenticatedClient = (hash: string, clientId: string) =>
  safeWrite((redis) =>
    redis.set(`pigeon:auth:client:${hash}`, clientId, 'PX', env.API_KEY_CACHE_TTL_MS),
  );

export const cacheInvalidApiKey = (hash: string) =>
  safeWrite((redis) =>
    redis.set(`pigeon:auth:invalid:${hash}`, '1', 'PX', env.API_KEY_NEGATIVE_CACHE_TTL_MS),
  );

export const closeApiKeyCache = closeRedisConnection;
