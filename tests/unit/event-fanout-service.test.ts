import { EventFanoutStatus, SubscriptionStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const logger = { child: vi.fn(), error: vi.fn() };
  logger.child.mockReturnValue(logger);

  return {
    logger,
    claimPendingEvents: vi.fn(),
    transaction: vi.fn(),
    findSubscriptions: vi.fn(),
    getCachedSubscriptionIds: vi.fn(),
    cacheSubscriptionIds: vi.fn(),
    createAttempts: vi.fn(),
    completeEvent: vi.fn(),
    resetEvent: vi.fn(),
  };
});

vi.mock('../../src/config/env', () => ({
  env: { EVENT_FANOUT_BATCH_SIZE: 100, EVENT_FANOUT_POLL_INTERVAL_MS: 1_000 },
}));

vi.mock('../../src/config/logger', () => ({ logger: mocks.logger }));

vi.mock('../../src/config/db', () => ({
  prisma: {
    $queryRaw: mocks.claimPendingEvents,
    $transaction: mocks.transaction,
    event: { updateMany: mocks.resetEvent },
    subscription: { findMany: mocks.findSubscriptions },
  },
}));

vi.mock('../../src/cache', () => ({
  getCachedSubscriptionIds: mocks.getCachedSubscriptionIds,
  cacheSubscriptionIds: mocks.cacheSubscriptionIds,
}));

import {
  fanoutPendingEvents,
  recoverInterruptedEventFanout,
} from '../../src/workers/fanout/fanout.processor';

const EVENT = {
  id: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  type: 'order.paid',
};

describe('event fan-out service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.logger.child.mockReturnValue(mocks.logger);
    mocks.claimPendingEvents.mockResolvedValue([EVENT]);
    mocks.getCachedSubscriptionIds.mockResolvedValue(null);
    mocks.cacheSubscriptionIds.mockResolvedValue(undefined);
    mocks.findSubscriptions.mockResolvedValue([{ id: '33333333-3333-4333-8333-333333333333' }]);
    mocks.createAttempts.mockResolvedValue({ count: 1 });
    mocks.completeEvent.mockResolvedValue({});
    mocks.resetEvent.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        deliveryAttempt: { createMany: mocks.createAttempts },
        event: { update: mocks.completeEvent },
      }),
    );
  });

  it('creates unpublished delivery attempts and completes the claimed event', async () => {
    await expect(fanoutPendingEvents()).resolves.toBe(1);

    expect(mocks.findSubscriptions).toHaveBeenCalledWith({
      where: {
        clientId: EVENT.clientId,
        status: SubscriptionStatus.ACTIVE,
        eventTypes: { has: EVENT.type },
      },
      select: { id: true },
    });
    expect(mocks.cacheSubscriptionIds).toHaveBeenCalledWith(EVENT.clientId, EVENT.type, [
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(mocks.createAttempts).toHaveBeenCalledWith({
      data: [
        {
          eventId: EVENT.id,
          subscriptionId: '33333333-3333-4333-8333-333333333333',
          status: 'PENDING',
          attemptNumber: 1,
        },
      ],
      skipDuplicates: true,
    });
    expect(mocks.completeEvent).toHaveBeenCalledWith({
      where: { id: EVENT.id },
      data: { fanoutStatus: EventFanoutStatus.COMPLETED },
    });
  });

  it('uses cached subscription IDs without querying PostgreSQL', async () => {
    mocks.getCachedSubscriptionIds.mockResolvedValue(['44444444-4444-4444-8444-444444444444']);

    await expect(fanoutPendingEvents()).resolves.toBe(1);

    expect(mocks.findSubscriptions).not.toHaveBeenCalled();
    expect(mocks.createAttempts).toHaveBeenCalledWith({
      data: [
        {
          eventId: EVENT.id,
          subscriptionId: '44444444-4444-4444-8444-444444444444',
          status: 'PENDING',
          attemptNumber: 1,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('returns an event to pending when its fan-out transaction fails', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(fanoutPendingEvents()).resolves.toBe(1);

    expect(mocks.resetEvent).toHaveBeenCalledWith({
      where: { id: EVENT.id, fanoutStatus: EventFanoutStatus.PROCESSING },
      data: { fanoutStatus: EventFanoutStatus.PENDING },
    });
  });

  it('makes interrupted fan-out eligible again when the worker starts', async () => {
    await recoverInterruptedEventFanout();

    expect(mocks.resetEvent).toHaveBeenCalledWith({
      where: { fanoutStatus: EventFanoutStatus.PROCESSING },
      data: { fanoutStatus: EventFanoutStatus.PENDING },
    });
  });
});
