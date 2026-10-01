import Redis, { RedisOptions } from 'ioredis';

import { env } from './env';
import { logger } from './logger';

let redisInstance: Redis | undefined;

export const getRedisClient = (customOptions?: RedisOptions): Redis => {
  if (!redisInstance) {
    redisInstance = new Redis(env.REDIS_URL, {
      // Default configurations for a fast, best-effort cache
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      ...customOptions,
    });

    redisInstance.on('error', (error) => {
      logger.warn({ err: error }, 'Redis connection error');
    });
  }
  return redisInstance;
};

export const closeRedisConnection = async () => {
  if (!redisInstance || redisInstance.status === 'wait' || redisInstance.status === 'end') {
    return;
  }

  if (redisInstance.status === 'ready') {
    await redisInstance.quit();
    return;
  }

  redisInstance.disconnect();
};
