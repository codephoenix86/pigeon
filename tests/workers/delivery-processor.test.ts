import { DeliveryStatus, SubscriptionStatus } from '@prisma/client';
import { DelayedError } from 'bullmq';
import type { Job } from 'bullmq';
import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeliveryJobData } from '../../src/queue';

const mocks = vi.hoisted(() => {
  const logger = {
    child: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  logger.child.mockReturnValue(logger);

  return {
    logger,
    findDelivery: vi.fn(),
    upsertAttempt: vi.fn(),
    updateAttempt: vi.fn(),
    updateManyAttempts: vi.fn(),
    createDeadLetterEntries: vi.fn(),
    transaction: vi.fn(),
    calculateBackoff: vi.fn(),
    publishDeadLetterEntries: vi.fn(),
    recordSuccess: vi.fn(),
    recordRetry: vi.fn(),
    recordPermanentFailure: vi.fn(),
    tryAcquireLease: vi.fn(),
    releaseLease: vi.fn(),
  };
});

vi.mock('../../src/config/env', () => ({
  env: {
    DELIVERY_TIMEOUT_MS: 50,
    DELIVERY_THROTTLE_DELAY_MS: 1_250,
  },
}));

vi.mock('../../src/config/logger', () => ({ logger: mocks.logger }));

vi.mock('../../src/db', () => ({
  prisma: {
    deliveryAttempt: {
      findUnique: mocks.findDelivery,
      upsert: mocks.upsertAttempt,
      update: mocks.updateAttempt,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../../src/services/delivery-backoff', () => ({
  calculateDeliveryBackoff: mocks.calculateBackoff,
}));

vi.mock('../../src/services/delivery-dead-letter-outbox-service', () => ({
  publishDeadLetterOutboxEntries: mocks.publishDeadLetterEntries,
}));

vi.mock('../../src/services/metrics-service', () => ({
  recordDeliverySuccess: mocks.recordSuccess,
  recordDeliveryRetry: mocks.recordRetry,
  recordDeliveryPermanentFailure: mocks.recordPermanentFailure,
}));

vi.mock('../../src/services/subscription-concurrency-service', () => ({
  tryAcquireSubscriptionLease: mocks.tryAcquireLease,
}));

import { deliveryBackoffStrategy, processDeliveryJob } from '../../src/workers/delivery-processor';

const INITIAL_ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const SUBSCRIPTION_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = 'delivery-job-1';
const JOB_TOKEN = 'worker-lock-token';
const TARGET_ORIGIN = 'https://subscriber.example';
const TARGET_PATH = '/webhooks';
const RETRY_DELAY_MS = 60_000;
const NOW = 1_789_387_200_000;

const payload = { orderId: 'ord_123', status: 'paid' };
const activeDelivery = {
  eventId: EVENT_ID,
  subscriptionId: SUBSCRIPTION_ID,
  event: { payload },
  subscription: {
    id: SUBSCRIPTION_ID,
    secret: 'whsec_test_secret',
    status: SubscriptionStatus.ACTIVE,
    targetUrl: `${TARGET_ORIGIN}${TARGET_PATH}`,
  },
};

type JobOptions = {
  id?: string;
  attemptsMade?: number;
  attempts?: number;
};

const createJob = ({ id = JOB_ID, attemptsMade = 0, attempts = 3 }: JobOptions = {}) => {
  const moveToDelayed = vi.fn().mockResolvedValue(undefined);
  const job = {
    id,
    data: { deliveryAttemptId: INITIAL_ATTEMPT_ID },
    attemptsMade,
    opts: { attempts },
    token: JOB_TOKEN,
    moveToDelayed,
  } as unknown as Job<DeliveryJobData>;

  return { job, moveToDelayed };
};

const interceptWebhook = (status: number) =>
  nock(TARGET_ORIGIN)
    .post(TARGET_PATH, payload)
    .matchHeader('content-type', 'application/json')
    .matchHeader('x-delivery-id', CURRENT_ATTEMPT_ID)
    .matchHeader('x-webhook-timestamp', /^\d{10}$/)
    .matchHeader('x-webhook-signature', /^sha256=[a-f0-9]{64}$/)
    .reply(status);

describe('delivery processor', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    mocks.logger.child.mockReturnValue(mocks.logger);
    mocks.findDelivery.mockResolvedValue(activeDelivery);
    mocks.upsertAttempt.mockResolvedValue({ id: CURRENT_ATTEMPT_ID });
    mocks.updateAttempt.mockResolvedValue({ id: CURRENT_ATTEMPT_ID });
    mocks.updateManyAttempts.mockResolvedValue({ count: 1 });
    mocks.createDeadLetterEntries.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(
      async (
        operation: (transaction: {
          deliveryAttempt: { updateMany: typeof mocks.updateManyAttempts };
          deliveryDeadLetterOutbox: { createMany: typeof mocks.createDeadLetterEntries };
        }) => Promise<unknown>,
      ) =>
        operation({
          deliveryAttempt: { updateMany: mocks.updateManyAttempts },
          deliveryDeadLetterOutbox: { createMany: mocks.createDeadLetterEntries },
        }),
    );
    mocks.calculateBackoff.mockReturnValue(RETRY_DELAY_MS);
    mocks.publishDeadLetterEntries.mockResolvedValue(1);
    mocks.releaseLease.mockResolvedValue(undefined);
    mocks.tryAcquireLease.mockResolvedValue({ release: mocks.releaseLease });
  });

  afterEach(() => {
    const pendingMocks = nock.pendingMocks();
    nock.cleanAll();
    expect(pendingMocks).toEqual([]);
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  it('posts a signed payload and records a successful delivery', async () => {
    interceptWebhook(204);
    const { job } = createJob();

    await expect(processDeliveryJob(job)).resolves.toBeUndefined();

    expect(mocks.findDelivery).toHaveBeenCalledWith({
      where: { id: INITIAL_ATTEMPT_ID },
      select: expect.any(Object),
    });
    expect(mocks.tryAcquireLease).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(mocks.upsertAttempt).toHaveBeenCalledWith({
      where: {
        eventId_subscriptionId_attemptNumber: {
          eventId: EVENT_ID,
          subscriptionId: SUBSCRIPTION_ID,
          attemptNumber: 1,
        },
      },
      create: {
        eventId: EVENT_ID,
        subscriptionId: SUBSCRIPTION_ID,
        status: DeliveryStatus.IN_PROGRESS,
        attemptNumber: 1,
      },
      update: {
        status: DeliveryStatus.IN_PROGRESS,
        httpStatus: null,
        nextRetryAt: null,
      },
      select: { id: true },
    });
    expect(mocks.updateAttempt).toHaveBeenCalledWith({
      where: { id: CURRENT_ATTEMPT_ID },
      data: {
        status: DeliveryStatus.DELIVERED,
        httpStatus: 204,
        nextRetryAt: null,
      },
    });
    expect(mocks.recordSuccess).toHaveBeenCalledOnce();
    expect(mocks.recordRetry).not.toHaveBeenCalled();
    expect(mocks.releaseLease).toHaveBeenCalledOnce();
  });

  it('records an HTTP failure and preserves its jittered delay for BullMQ', async () => {
    interceptWebhook(503);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const { job } = createJob();

    await expect(processDeliveryJob(job)).rejects.toThrow(
      'Webhook endpoint responded with HTTP 503.',
    );

    expect(mocks.calculateBackoff).toHaveBeenCalledWith(1);
    expect(mocks.updateAttempt).toHaveBeenCalledWith({
      where: { id: CURRENT_ATTEMPT_ID },
      data: {
        status: DeliveryStatus.RETRY_SCHEDULED,
        httpStatus: 503,
        nextRetryAt: new Date(NOW + RETRY_DELAY_MS),
      },
    });
    expect(mocks.recordRetry).toHaveBeenCalledOnce();
    expect(mocks.recordPermanentFailure).not.toHaveBeenCalled();
    expect(mocks.releaseLease).toHaveBeenCalledOnce();

    expect(deliveryBackoffStrategy(1, { id: JOB_ID })).toBe(RETRY_DELAY_MS);
    expect(mocks.calculateBackoff).toHaveBeenCalledOnce();
    expect(deliveryBackoffStrategy(2, { id: JOB_ID })).toBe(RETRY_DELAY_MS);
    expect(mocks.calculateBackoff).toHaveBeenCalledTimes(2);
  });

  it('schedules a retry with no HTTP status after a network failure', async () => {
    nock(TARGET_ORIGIN).post(TARGET_PATH, payload).replyWithError('connection reset');
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const { job } = createJob({ id: 'network-failure-job' });

    await expect(processDeliveryJob(job)).rejects.toBeInstanceOf(Error);

    expect(mocks.updateAttempt).toHaveBeenCalledWith({
      where: { id: CURRENT_ATTEMPT_ID },
      data: {
        status: DeliveryStatus.RETRY_SCHEDULED,
        httpStatus: null,
        nextRetryAt: new Date(NOW + RETRY_DELAY_MS),
      },
    });
    expect(mocks.recordRetry).toHaveBeenCalledOnce();
    expect(deliveryBackoffStrategy(1, { id: 'network-failure-job' })).toBe(RETRY_DELAY_MS);
  });

  it('aborts a timed-out webhook request and schedules a retry', async () => {
    nock(TARGET_ORIGIN).post(TARGET_PATH, payload).delay(100).reply(204);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const { job } = createJob({ id: 'timeout-job' });

    await expect(processDeliveryJob(job)).rejects.toBeInstanceOf(Error);

    expect(mocks.updateAttempt).toHaveBeenCalledWith({
      where: { id: CURRENT_ATTEMPT_ID },
      data: {
        status: DeliveryStatus.RETRY_SCHEDULED,
        httpStatus: null,
        nextRetryAt: new Date(NOW + RETRY_DELAY_MS),
      },
    });
    expect(mocks.recordRetry).toHaveBeenCalledOnce();
    expect(deliveryBackoffStrategy(1, { id: 'timeout-job' })).toBe(RETRY_DELAY_MS);
  });

  it('marks an exhausted delivery as permanently failed and publishes it to the DLQ', async () => {
    interceptWebhook(500);
    const { job } = createJob({ id: 'exhausted-job', attemptsMade: 2, attempts: 3 });

    await expect(processDeliveryJob(job)).rejects.toThrow(
      'Webhook endpoint responded with HTTP 500.',
    );

    expect(mocks.updateManyAttempts).toHaveBeenCalledWith({
      where: {
        id: CURRENT_ATTEMPT_ID,
        status: {
          notIn: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED_PERMANENT],
        },
      },
      data: {
        status: DeliveryStatus.FAILED_PERMANENT,
        httpStatus: 500,
        nextRetryAt: null,
      },
    });
    expect(mocks.createDeadLetterEntries).toHaveBeenCalledWith({
      data: [
        {
          deliveryAttemptId: CURRENT_ATTEMPT_ID,
          attemptsMade: 3,
          failedAt: expect.any(Date),
          failedReason: 'Webhook endpoint responded with HTTP 500.',
        },
      ],
      skipDuplicates: true,
    });
    expect(mocks.publishDeadLetterEntries).toHaveBeenCalledWith([CURRENT_ATTEMPT_ID]);
    expect(mocks.recordPermanentFailure).toHaveBeenCalledOnce();
    expect(mocks.recordRetry).not.toHaveBeenCalled();
    expect(mocks.releaseLease).toHaveBeenCalledOnce();
  });

  it('does not duplicate a terminal dead-letter transition', async () => {
    interceptWebhook(500);
    mocks.updateManyAttempts.mockResolvedValue({ count: 0 });
    const { job } = createJob({ attemptsMade: 2, attempts: 3 });

    await expect(processDeliveryJob(job)).rejects.toThrow(
      'Webhook endpoint responded with HTTP 500.',
    );

    expect(mocks.createDeadLetterEntries).not.toHaveBeenCalled();
    expect(mocks.publishDeadLetterEntries).not.toHaveBeenCalled();
    expect(mocks.recordPermanentFailure).not.toHaveBeenCalled();
  });

  it.each([
    ['a deleted delivery', null],
    [
      'a disabled subscription',
      {
        ...activeDelivery,
        subscription: { ...activeDelivery.subscription, status: SubscriptionStatus.DISABLED },
      },
    ],
  ])('skips %s as stale work', async (_case, delivery) => {
    mocks.findDelivery.mockResolvedValue(delivery);
    const { job } = createJob();

    await expect(processDeliveryJob(job)).resolves.toBeUndefined();

    expect(mocks.tryAcquireLease).not.toHaveBeenCalled();
    expect(mocks.upsertAttempt).not.toHaveBeenCalled();
  });

  it('delays a job without consuming an attempt when subscription capacity is exhausted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    mocks.tryAcquireLease.mockResolvedValue(null);
    const { job, moveToDelayed } = createJob();

    await expect(processDeliveryJob(job)).rejects.toBeInstanceOf(DelayedError);

    expect(moveToDelayed).toHaveBeenCalledWith(NOW + 1_250, JOB_TOKEN);
    expect(mocks.upsertAttempt).not.toHaveBeenCalled();
    expect(mocks.calculateBackoff).not.toHaveBeenCalled();
    expect(mocks.releaseLease).not.toHaveBeenCalled();
  });

  it('keeps a successful result when releasing the concurrency lease fails', async () => {
    interceptWebhook(200);
    mocks.releaseLease.mockRejectedValue(new Error('Redis unavailable'));
    const { job } = createJob();

    await expect(processDeliveryJob(job)).resolves.toBeUndefined();

    expect(mocks.recordSuccess).toHaveBeenCalledOnce();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Failed to release subscription concurrency lease',
    );
  });
});
