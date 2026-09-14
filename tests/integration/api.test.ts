import { DeliveryStatus, SubscriptionStatus } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  process.env.LOG_LEVEL = 'silent';

  return {
    findClientByApiKey: vi.fn(),
    createSubscription: vi.fn(),
    listSubscriptions: vi.fn(),
    getSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
    createEvent: vi.fn(),
    listEventDeliveries: vi.fn(),
    listFailedDeliveries: vi.fn(),
    getHealth: vi.fn(),
    renderMetrics: vi.fn(),
  };
});

vi.mock('../../src/services/client-service', () => ({
  findClientByApiKey: mocks.findClientByApiKey,
}));

vi.mock('../../src/services/subscription-service', () => ({
  createSubscription: mocks.createSubscription,
  listSubscriptions: mocks.listSubscriptions,
  getSubscription: mocks.getSubscription,
  updateSubscription: mocks.updateSubscription,
  deleteSubscription: mocks.deleteSubscription,
}));

vi.mock('../../src/services/event-service', () => ({
  createEvent: mocks.createEvent,
  listEventDeliveries: mocks.listEventDeliveries,
}));

vi.mock('../../src/services/failed-delivery-service', () => ({
  listFailedDeliveries: mocks.listFailedDeliveries,
}));

vi.mock('../../src/services/health-service', () => ({
  getHealth: mocks.getHealth,
}));

vi.mock('../../src/services/metrics-service', () => ({
  metricsRegistry: {
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
    metrics: mocks.renderMetrics,
  },
}));

import { createApp } from '../../src/app';
import { AppError } from '../../src/errors/app-error';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const DELIVERY_ID = '44444444-4444-4444-8444-444444444444';
const API_KEY = 'pgn_test_api_key';
const CREATED_AT = new Date('2026-09-14T10:00:00.000Z');
const UPDATED_AT = new Date('2026-09-14T10:05:00.000Z');

const subscription = {
  id: SUBSCRIPTION_ID,
  targetUrl: 'https://example.com/webhooks',
  eventTypes: ['order.created', 'order.paid'],
  status: SubscriptionStatus.ACTIVE,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const event = {
  id: EVENT_ID,
  type: 'order.paid',
  payload: { orderId: 'ord_123', amount: 4_200 },
  source: 'checkout',
  createdAt: CREATED_AT,
};

const delivery = {
  id: DELIVERY_ID,
  subscriptionId: SUBSCRIPTION_ID,
  status: DeliveryStatus.DELIVERED,
  httpStatus: 204,
  attemptNumber: 1,
  nextRetryAt: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const app = createApp();

describe('Pigeon API', () => {
  beforeEach(() => {
    mocks.findClientByApiKey.mockImplementation(async (apiKey: string) =>
      apiKey === API_KEY ? { id: CLIENT_ID } : null,
    );
  });

  describe('request handling', () => {
    it('rejects a protected request without an API key', async () => {
      const response = await request(app).get('/subscriptions');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'An X-API-Key header is required.',
        },
      });
      expect(mocks.findClientByApiKey).not.toHaveBeenCalled();
    });

    it('rejects an invalid API key', async () => {
      const response = await request(app).get('/subscriptions').set('X-API-Key', 'invalid');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
      expect(mocks.findClientByApiKey).toHaveBeenCalledWith('invalid');
    });

    it('returns the validation error shape for an invalid body', async () => {
      const response = await request(app)
        .post('/subscriptions')
        .set('X-API-Key', API_KEY)
        .send({ targetUrl: 'not-a-url', eventTypes: [] });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request is invalid.',
          details: { fieldErrors: { targetUrl: expect.any(Array), eventTypes: expect.any(Array) } },
        },
      });
      expect(mocks.createSubscription).not.toHaveBeenCalled();
    });

    it('returns a consistent error for malformed JSON', async () => {
      const response = await request(app)
        .post('/events')
        .set('X-API-Key', API_KEY)
        .set('Content-Type', 'application/json')
        .send('{"type":');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'INVALID_JSON',
          message: 'The request body contains invalid JSON.',
        },
      });
    });

    it('maps application errors returned by services', async () => {
      mocks.getSubscription.mockRejectedValue(
        new AppError(404, 'NOT_FOUND', 'Subscription not found.'),
      );

      const response = await request(app)
        .get(`/subscriptions/${SUBSCRIPTION_ID}`)
        .set('X-API-Key', API_KEY);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Subscription not found.' },
      });
    });

    it('hides unexpected error details', async () => {
      mocks.listSubscriptions.mockRejectedValue(new Error('database credentials leaked'));

      const response = await request(app).get('/subscriptions').set('X-API-Key', API_KEY);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
        },
      });
      expect(response.text).not.toContain('database credentials leaked');
    });

    it('returns a request ID and a consistent not-found response', async () => {
      const response = await request(app)
        .get('/unknown-route')
        .set('X-Request-Id', 'integration-test-request');

      expect(response.status).toBe(404);
      expect(response.headers['x-request-id']).toBe('integration-test-request');
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.body).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'No route matches GET /unknown-route.',
        },
      });
    });
  });

  describe('subscription routes', () => {
    it('creates a subscription and returns its secret once', async () => {
      mocks.createSubscription.mockResolvedValue({
        subscription,
        secret: 'whsec_created_once',
      });

      const response = await request(app)
        .post('/subscriptions')
        .set('X-API-Key', API_KEY)
        .send({
          targetUrl: subscription.targetUrl,
          eventTypes: ['order.created', ' order.created ', 'order.paid'],
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        subscription: {
          ...subscription,
          createdAt: CREATED_AT.toISOString(),
          updatedAt: UPDATED_AT.toISOString(),
        },
        secret: 'whsec_created_once',
      });
      expect(mocks.createSubscription).toHaveBeenCalledWith(CLIENT_ID, {
        targetUrl: subscription.targetUrl,
        eventTypes: ['order.created', 'order.paid'],
      });
    });

    it('lists subscriptions with a status filter', async () => {
      mocks.listSubscriptions.mockResolvedValue([subscription]);

      const response = await request(app)
        .get('/subscriptions')
        .query({ status: SubscriptionStatus.ACTIVE })
        .set('X-API-Key', API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.subscriptions).toHaveLength(1);
      expect(mocks.listSubscriptions).toHaveBeenCalledWith(CLIENT_ID, SubscriptionStatus.ACTIVE);
    });

    it('gets an owned subscription', async () => {
      mocks.getSubscription.mockResolvedValue(subscription);

      const response = await request(app)
        .get(`/subscriptions/${SUBSCRIPTION_ID}`)
        .set('X-API-Key', API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.subscription.id).toBe(SUBSCRIPTION_ID);
      expect(mocks.getSubscription).toHaveBeenCalledWith(CLIENT_ID, SUBSCRIPTION_ID);
    });

    it('updates an owned subscription', async () => {
      const disabledSubscription = { ...subscription, status: SubscriptionStatus.DISABLED };
      mocks.updateSubscription.mockResolvedValue(disabledSubscription);

      const response = await request(app)
        .patch(`/subscriptions/${SUBSCRIPTION_ID}`)
        .set('X-API-Key', API_KEY)
        .send({ status: SubscriptionStatus.DISABLED });

      expect(response.status).toBe(200);
      expect(response.body.subscription.status).toBe(SubscriptionStatus.DISABLED);
      expect(mocks.updateSubscription).toHaveBeenCalledWith(CLIENT_ID, SUBSCRIPTION_ID, {
        status: SubscriptionStatus.DISABLED,
      });
    });

    it('disables an owned subscription', async () => {
      mocks.deleteSubscription.mockResolvedValue(undefined);

      const response = await request(app)
        .delete(`/subscriptions/${SUBSCRIPTION_ID}`)
        .set('X-API-Key', API_KEY);

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      expect(mocks.deleteSubscription).toHaveBeenCalledWith(CLIENT_ID, SUBSCRIPTION_ID);
    });
  });

  describe('event and delivery routes', () => {
    it('accepts an event for asynchronous delivery', async () => {
      mocks.createEvent.mockResolvedValue({ event, deliveryCount: 2 });

      const response = await request(app)
        .post('/events')
        .set('X-API-Key', API_KEY)
        .send({ type: ' order.paid ', payload: event.payload, source: ' checkout ' });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({
        event: { ...event, createdAt: CREATED_AT.toISOString() },
        deliveryCount: 2,
      });
      expect(mocks.createEvent).toHaveBeenCalledWith(CLIENT_ID, {
        type: 'order.paid',
        payload: event.payload,
        source: 'checkout',
      });
      expect(response.headers['ratelimit-policy']).toBeDefined();
    });

    it('lists delivery history for an event', async () => {
      mocks.listEventDeliveries.mockResolvedValue([delivery]);

      const response = await request(app)
        .get(`/events/${EVENT_ID}/deliveries`)
        .set('X-API-Key', API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.deliveries[0]).toEqual({
        ...delivery,
        createdAt: CREATED_AT.toISOString(),
        updatedAt: UPDATED_AT.toISOString(),
      });
      expect(mocks.listEventDeliveries).toHaveBeenCalledWith(CLIENT_ID, EVENT_ID);
    });

    it('lists failed deliveries with parsed pagination', async () => {
      const result = {
        deliveries: [{ ...delivery, status: DeliveryStatus.FAILED_PERMANENT }],
        pagination: { limit: 20, offset: 40, nextOffset: null },
      };
      mocks.listFailedDeliveries.mockResolvedValue(result);

      const response = await request(app)
        .get('/deliveries/failed')
        .query({ limit: '20', offset: '40' })
        .set('X-API-Key', API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.pagination).toEqual(result.pagination);
      expect(mocks.listFailedDeliveries).toHaveBeenCalledWith(CLIENT_ID, {
        limit: 20,
        offset: 40,
      });
    });
  });

  describe('operational routes', () => {
    it.each([
      [true, 200, 'ok'],
      [false, 503, 'unavailable'],
    ])(
      'returns dependency health with the appropriate status',
      async (isHealthy, status, state) => {
        mocks.getHealth.mockResolvedValue({
          isHealthy,
          body: {
            status: state,
            checks: {
              database: { status: isHealthy ? 'up' : 'down', responseTimeMs: 1 },
              redis: { status: 'up', responseTimeMs: 1 },
            },
          },
        });

        const response = await request(app).get('/health');

        expect(response.status).toBe(status);
        expect(response.body.status).toBe(state);
        expect(response.headers['cache-control']).toBe('no-store');
      },
    );

    it('serves Prometheus metrics', async () => {
      mocks.renderMetrics.mockResolvedValue('# HELP pigeon_up Service availability\npigeon_up 1\n');

      const response = await request(app).get('/metrics');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.text).toContain('pigeon_up 1');
    });
  });
});
