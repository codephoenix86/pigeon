import { DeliveryStatus } from '@prisma/client';

const pendingStatuses = new Set([
  DeliveryStatus.PENDING,
  DeliveryStatus.IN_PROGRESS,
  DeliveryStatus.RETRY_SCHEDULED,
]);

export const summarizeDeliveryAttempts = (attempts) => {
  const latestAttempts = new Map();
  let successfulAttempts = 0;

  for (const attempt of attempts) {
    if (attempt.status === DeliveryStatus.DELIVERED) {
      successfulAttempts += 1;
    }

    const key = `${attempt.eventId}:${attempt.subscriptionId}`;
    const latestAttempt = latestAttempts.get(key);

    if (!latestAttempt || attempt.attemptNumber > latestAttempt.attemptNumber) {
      latestAttempts.set(key, attempt);
    }
  }

  const logicalDeliveries = [...latestAttempts.values()];
  const successfulDeliveries = logicalDeliveries.filter(
    (attempt) => attempt.status === DeliveryStatus.DELIVERED,
  ).length;
  const pendingDeliveries = logicalDeliveries.filter((attempt) =>
    pendingStatuses.has(attempt.status),
  ).length;

  return {
    attemptSuccessRate: attempts.length === 0 ? 0 : (successfulAttempts / attempts.length) * 100,
    eventualSuccessRate:
      logicalDeliveries.length === 0 ? 0 : (successfulDeliveries / logicalDeliveries.length) * 100,
    pendingDeliveries,
    successfulAttempts,
    successfulDeliveries,
    totalAttempts: attempts.length,
    totalLogicalDeliveries: logicalDeliveries.length,
  };
};
