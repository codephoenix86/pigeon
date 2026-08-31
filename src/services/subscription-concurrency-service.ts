import { randomUUID } from 'node:crypto';

import Redis from 'ioredis';

import { env } from '../config/env';

const LEASE_TTL_MS = Math.max(env.DELIVERY_TIMEOUT_MS + 15_000, 30_000);
const LEASE_RENEW_INTERVAL_MS = Math.floor(LEASE_TTL_MS / 3);
const LEASE_KEY_PREFIX = 'pigeon:delivery:subscription-leases';

const ACQUIRE_LEASE_SCRIPT = `
local redisTime = redis.call('TIME')
local now = redisTime[1] * 1000 + math.floor(redisTime[2] / 1000)
local expiresAt = now + tonumber(ARGV[1])

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)

if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end

redis.call('ZADD', KEYS[1], expiresAt, ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
return 1
`;

const RENEW_LEASE_SCRIPT = `
if not redis.call('ZSCORE', KEYS[1], ARGV[2]) then
  return 0
end

local redisTime = redis.call('TIME')
local now = redisTime[1] * 1000 + math.floor(redisTime[2] / 1000)
local expiresAt = now + tonumber(ARGV[1])

redis.call('ZADD', KEYS[1], 'XX', expiresAt, ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
return 1
`;

const RELEASE_LEASE_SCRIPT = `
local removed = redis.call('ZREM', KEYS[1], ARGV[1])

if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
end

return removed
`;

const redis = new Redis(env.REDIS_URL, {
  // A delivery must not bypass the distributed limit because of a transient
  // Redis failure. Wait for reconnection instead of dropping semaphore calls.
  maxRetriesPerRequest: null,
});

redis.on('error', (error) => {
  console.error('Subscription concurrency Redis error', error);
});

const leaseKey = (subscriptionId: string) => `${LEASE_KEY_PREFIX}:${subscriptionId}`;

export type SubscriptionConcurrencyLease = {
  release: () => Promise<void>;
};

export const tryAcquireSubscriptionLease = async (
  subscriptionId: string,
): Promise<SubscriptionConcurrencyLease | null> => {
  const key = leaseKey(subscriptionId);
  const token = randomUUID();
  const acquired = Number(
    await redis.eval(
      ACQUIRE_LEASE_SCRIPT,
      1,
      key,
      LEASE_TTL_MS,
      env.DELIVERY_SUBSCRIPTION_CONCURRENCY,
      token,
    ),
  );

  if (acquired !== 1) {
    return null;
  }

  let isReleased = false;
  let renewalInFlight = false;

  const renewLease = async () => {
    if (isReleased || renewalInFlight) {
      return;
    }

    renewalInFlight = true;

    try {
      const renewed = Number(await redis.eval(RENEW_LEASE_SCRIPT, 1, key, LEASE_TTL_MS, token));

      if (renewed !== 1 && !isReleased) {
        console.error('Subscription concurrency lease expired before release', {
          subscriptionId,
          token,
        });
      }
    } catch (error) {
      if (!isReleased) {
        console.error('Failed to renew subscription concurrency lease', {
          subscriptionId,
          token,
          error,
        });
      }
    } finally {
      renewalInFlight = false;
    }
  };

  const renewalTimer = setInterval(() => {
    void renewLease();
  }, LEASE_RENEW_INTERVAL_MS);
  renewalTimer.unref();

  return {
    release: async () => {
      if (isReleased) {
        return;
      }

      isReleased = true;
      clearInterval(renewalTimer);
      await redis.eval(RELEASE_LEASE_SCRIPT, 1, key, token);
    },
  };
};

export const waitForSubscriptionConcurrency = async () => {
  await redis.ping();
};

export const closeSubscriptionConcurrency = async () => {
  if (redis.status !== 'end') {
    await redis.quit();
  }
};
