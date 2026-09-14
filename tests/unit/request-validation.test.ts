import { SubscriptionStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  createEventSchema,
  createSubscriptionSchema,
  eventTypeSchema,
  idParamsSchema,
  listFailedDeliveriesQuerySchema,
  listSubscriptionsQuerySchema,
  updateSubscriptionSchema,
} from '../../src/validation/request-schemas';

describe('request validation', () => {
  describe('shared parameters', () => {
    it('accepts UUID identifiers', () => {
      const id = 'f7653f54-6ba6-4f9d-a90f-250c3e2cc80e';

      expect(idParamsSchema.parse({ id })).toEqual({ id });
    });

    it('rejects malformed identifiers', () => {
      expect(idParamsSchema.safeParse({ id: 'delivery-123' }).success).toBe(false);
    });

    it('normalizes a valid event type', () => {
      expect(eventTypeSchema.parse('  order.paid:v2  ')).toBe('order.paid:v2');
    });

    it.each(['', 'contains spaces', '_starts-with-symbol', 'a'.repeat(256)])(
      'rejects the invalid event type %j',
      (eventType) => {
        expect(eventTypeSchema.safeParse(eventType).success).toBe(false);
      },
    );
  });

  describe('subscription schemas', () => {
    it('accepts a subscription and removes duplicate normalized event types', () => {
      expect(
        createSubscriptionSchema.parse({
          targetUrl: 'https://example.com/webhooks',
          eventTypes: ['order.created', ' order.created ', 'order.paid'],
        }),
      ).toEqual({
        targetUrl: 'https://example.com/webhooks',
        eventTypes: ['order.created', 'order.paid'],
      });
    });

    it.each([
      [{ targetUrl: 'not-a-url', eventTypes: ['order.created'] }],
      [{ targetUrl: 'https://example.com', eventTypes: [] }],
      [{ targetUrl: 'https://example.com', eventTypes: ['order.created'], extra: true }],
    ])('rejects an invalid subscription body', (body) => {
      expect(createSubscriptionSchema.safeParse(body).success).toBe(false);
    });

    it('requires at least one update field', () => {
      expect(updateSubscriptionSchema.safeParse({}).success).toBe(false);
    });

    it('accepts a valid subscription status update', () => {
      expect(updateSubscriptionSchema.parse({ status: SubscriptionStatus.DISABLED })).toEqual({
        status: SubscriptionStatus.DISABLED,
      });
    });

    it('validates the optional subscription status filter', () => {
      expect(listSubscriptionsQuerySchema.parse({ status: SubscriptionStatus.ACTIVE })).toEqual({
        status: SubscriptionStatus.ACTIVE,
      });
      expect(listSubscriptionsQuerySchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
    });
  });

  describe('event schemas', () => {
    it('accepts and normalizes a valid event', () => {
      expect(
        createEventSchema.parse({
          type: ' order.paid ',
          payload: { orderId: 'ord_123', amount: 4_200 },
          source: ' checkout ',
        }),
      ).toEqual({
        type: 'order.paid',
        payload: { orderId: 'ord_123', amount: 4_200 },
        source: 'checkout',
      });
    });

    it.each([
      [{ type: 'order.paid', payload: [] }],
      [{ type: 'order paid', payload: {} }],
      [{ type: 'order.paid', payload: {}, unexpected: true }],
    ])('rejects an invalid event body', (body) => {
      expect(createEventSchema.safeParse(body).success).toBe(false);
    });
  });

  describe('failed-delivery query schema', () => {
    it('supplies pagination defaults', () => {
      expect(listFailedDeliveriesQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    });

    it('coerces valid query-string pagination values', () => {
      expect(listFailedDeliveriesQuerySchema.parse({ limit: '25', offset: '50' })).toEqual({
        limit: 25,
        offset: 50,
      });
    });

    it.each([
      [{ limit: '0' }],
      [{ limit: '101' }],
      [{ offset: '-1' }],
      [{ offset: '100001' }],
      [{ unknown: 'value' }],
    ])('rejects invalid pagination', (query) => {
      expect(listFailedDeliveriesQuerySchema.safeParse(query).success).toBe(false);
    });
  });
});
