import { SubscriptionStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  validateWebhookTargetUrl: vi.fn(),
  invalidateSubscriptionRouting: vi.fn(),
}));

vi.mock('../../src/config/db', () => ({
  prisma: {
    subscription: {
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
    },
  },
}));

vi.mock('../../src/api/modules/subscription/subscription.utils', () => ({
  validateWebhookTargetUrl: mocks.validateWebhookTargetUrl,
}));

vi.mock('../../src/cache', () => ({
  invalidateSubscriptionRouting: mocks.invalidateSubscriptionRouting,
}));

import {
  createSubscription,
  deleteSubscription,
  updateSubscription,
} from '../../src/api/modules/subscription/subscription.service';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION = {
  id: '22222222-2222-4222-8222-222222222222',
  targetUrl: 'https://example.test/webhooks',
  eventTypes: ['order.created'],
  status: SubscriptionStatus.ACTIVE,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('subscription service routing cache invalidation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.validateWebhookTargetUrl.mockResolvedValue(SUBSCRIPTION.targetUrl);
    mocks.invalidateSubscriptionRouting.mockResolvedValue(undefined);
  });

  it('invalidates event-type routes after creating a subscription', async () => {
    mocks.create.mockResolvedValue(SUBSCRIPTION);

    await createSubscription(CLIENT_ID, {
      targetUrl: SUBSCRIPTION.targetUrl,
      eventTypes: SUBSCRIPTION.eventTypes,
    });

    expect(mocks.invalidateSubscriptionRouting).toHaveBeenCalledWith(CLIENT_ID, ['order.created']);
  });

  it('invalidates old and new event-type routes after changing filters', async () => {
    mocks.findFirst.mockResolvedValue(SUBSCRIPTION);
    mocks.update.mockResolvedValue({ ...SUBSCRIPTION, eventTypes: ['invoice.paid'] });

    await updateSubscription(CLIENT_ID, SUBSCRIPTION.id, { eventTypes: ['invoice.paid'] });

    expect(mocks.invalidateSubscriptionRouting).toHaveBeenCalledWith(CLIENT_ID, [
      'order.created',
      'invoice.paid',
    ]);
  });

  it('invalidates routes after disabling a subscription', async () => {
    mocks.findFirst.mockResolvedValue(SUBSCRIPTION);
    mocks.update.mockResolvedValue({});

    await deleteSubscription(CLIENT_ID, SUBSCRIPTION.id);

    expect(mocks.invalidateSubscriptionRouting).toHaveBeenCalledWith(CLIENT_ID, ['order.created']);
  });
});
