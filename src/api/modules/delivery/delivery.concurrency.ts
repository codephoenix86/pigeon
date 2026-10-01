import { randomUUID } from 'node:crypto';

import Redis from 'ioredis';

import { env } from '../../../config/env';
import { logger } from '../../../config/logger';

const concurrencyLogger = logger.child({ component: 'subscription-concurrency' });
const leaseTtlMs = Math.max(env.DELIVERY_TIMEOUT_MS + 15_000, 30_000);
const leaseRenewIntervalMs = Math.floor(leaseTtlMs / 3);
const leaseKeyPrefix = 'pigeon:delivery:subscription-leases';
const acquireLeaseScript = `
local redisTime = redis.call('TIME')
local now = redisTime[1] * 1000 + math.floor(redisTime[2] / 1000)
local expiresAt = now + tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], expiresAt, ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
return 1
`;
const renewLeaseScript = `
if not redis.call('ZSCORE', KEYS[1], ARGV[2]) then return 0 end
local redisTime = redis.call('TIME')
local now = redisTime[1] * 1000 + math.floor(redisTime[2] / 1000)
local expiresAt = now + tonumber(ARGV[1])
redis.call('ZADD', KEYS[1], 'XX', expiresAt, ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
return 1
`;
const releaseLeaseScript = `
local removed = redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end
return removed
`;
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
redis.on('error', (error) =>
  concurrencyLogger.error({ err: error }, 'Subscription concurrency Redis error'),
);
const leaseKey = (subscriptionId: string) => `${leaseKeyPrefix}:${subscriptionId}`;

export type SubscriptionConcurrencyLease = { release: () => Promise<void> };
export const tryAcquireSubscriptionLease = async (
  subscriptionId: string,
): Promise<SubscriptionConcurrencyLease | null> => {
  const key = leaseKey(subscriptionId);
  const token = randomUUID();
  const acquired = Number(
    await redis.eval(
      acquireLeaseScript,
      1,
      key,
      leaseTtlMs,
      env.DELIVERY_SUBSCRIPTION_CONCURRENCY,
      token,
    ),
  );
  if (acquired !== 1) return null;
  let isReleased = false;
  let renewalInFlight = false;
  const renewLease = async () => {
    if (isReleased || renewalInFlight) return;
    renewalInFlight = true;
    try {
      const renewed = Number(await redis.eval(renewLeaseScript, 1, key, leaseTtlMs, token));
      if (renewed !== 1 && !isReleased)
        concurrencyLogger.warn(
          { subscriptionId, leaseToken: token },
          'Subscription concurrency lease expired before release',
        );
    } catch (error) {
      if (!isReleased)
        concurrencyLogger.error(
          { err: error, subscriptionId, leaseToken: token },
          'Failed to renew subscription concurrency lease',
        );
    } finally {
      renewalInFlight = false;
    }
  };
  const renewalTimer = setInterval(() => void renewLease(), leaseRenewIntervalMs);
  renewalTimer.unref();
  return {
    release: async () => {
      if (isReleased) return;
      isReleased = true;
      clearInterval(renewalTimer);
      await redis.eval(releaseLeaseScript, 1, key, token);
    },
  };
};
export const waitForSubscriptionConcurrency = async () => redis.ping();
export const closeSubscriptionConcurrency = async () => {
  if (redis.status !== 'end') await redis.quit();
};
