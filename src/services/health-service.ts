import { env } from '../config/env';
import { getLogger } from '../config/logger';
import { prisma } from '../db';
import { deliveryQueue } from '../queue';

type DependencyName = 'database' | 'redis';
type DependencyStatus = 'up' | 'down';

type DependencyCheck = {
  status: DependencyStatus;
  responseTimeMs: number;
};

const elapsedMilliseconds = (startedAt: number): number =>
  Math.max(0, Math.round(performance.now() - startedAt));

const withTimeout = async <T>(operation: Promise<T>): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Health check timed out after ${env.HEALTH_CHECK_TIMEOUT_MS}ms.`)),
          env.HEALTH_CHECK_TIMEOUT_MS,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const checkDependency = async (
  dependency: DependencyName,
  check: () => Promise<unknown>,
): Promise<[DependencyName, DependencyCheck]> => {
  const startedAt = performance.now();

  try {
    await withTimeout(check());

    return [dependency, { status: 'up', responseTimeMs: elapsedMilliseconds(startedAt) }];
  } catch (error) {
    const responseTimeMs = elapsedMilliseconds(startedAt);
    getLogger().warn({ err: error, dependency, responseTimeMs }, 'Health dependency check failed');

    return [dependency, { status: 'down', responseTimeMs }];
  }
};

const checkDatabase = () => prisma.$queryRaw`SELECT 1`;

const checkRedis = async () => {
  // A queue command verifies that Redis can serve requests, not merely that
  // BullMQ once established a connection during startup.
  await deliveryQueue.count();
};

export const getHealth = async () => {
  const results = await Promise.all([
    checkDependency('database', checkDatabase),
    checkDependency('redis', checkRedis),
  ]);
  const checks = Object.fromEntries(results) as Record<DependencyName, DependencyCheck>;
  const isHealthy = Object.values(checks).every((check) => check.status === 'up');

  return {
    isHealthy,
    body: {
      status: isHealthy ? ('ok' as const) : ('unavailable' as const),
      checks,
    },
  };
};
