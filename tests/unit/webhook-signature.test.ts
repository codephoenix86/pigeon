import { describe, expect, it } from 'vitest';

import {
  createWebhookTimestamp,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../../src/services/webhook-signature';

const payload = '{"orderId":"ord_123","status":"paid"}';
const secret = 'whsec_test_secret';
const timestamp = '1789372800';
const deliveryId = 'delivery-123';

describe('webhook signatures', () => {
  it('creates a Unix timestamp rounded down to whole seconds', () => {
    expect(createWebhookTimestamp(new Date('2026-09-14T12:34:56.999Z'))).toBe('1789389296');
  });

  it('generates the expected HMAC-SHA256 signature', () => {
    expect(signWebhookPayload(payload, secret, timestamp, deliveryId)).toBe(
      'sha256=3502ad592c031521c350ed39ed5fea8657de5292f11016ae84410a69e74f7cc9',
    );
  });

  it.each([
    ['payload', '{"orderId":"ord_123","status":"refunded"}', secret, timestamp, deliveryId],
    ['secret', payload, 'another_secret', timestamp, deliveryId],
    ['timestamp', payload, secret, '1789372801', deliveryId],
    ['delivery ID', payload, secret, timestamp, 'delivery-456'],
  ])(
    'binds the signature to the %s',
    (_field, changedPayload, changedSecret, changedAt, changedId) => {
      const original = signWebhookPayload(payload, secret, timestamp, deliveryId);

      expect(signWebhookPayload(changedPayload, changedSecret, changedAt, changedId)).not.toBe(
        original,
      );
    },
  );

  it('verifies a valid signature', () => {
    const signature = signWebhookPayload(payload, secret, timestamp, deliveryId);

    expect(verifyWebhookSignature(payload, secret, timestamp, deliveryId, signature)).toBe(true);
  });

  it.each([
    ['a changed payload', '{"orderId":"ord_456"}', secret, timestamp, deliveryId],
    ['a different secret', payload, 'wrong_secret', timestamp, deliveryId],
    ['a changed timestamp', payload, secret, '1789372801', deliveryId],
    ['a changed delivery ID', payload, secret, timestamp, 'delivery-456'],
  ])(
    'rejects a signature when given %s',
    (_case, changedPayload, changedSecret, changedAt, changedId) => {
      const signature = signWebhookPayload(payload, secret, timestamp, deliveryId);

      expect(
        verifyWebhookSignature(changedPayload, changedSecret, changedAt, changedId, signature),
      ).toBe(false);
    },
  );

  it('rejects a malformed signature without throwing', () => {
    expect(verifyWebhookSignature(payload, secret, timestamp, deliveryId, 'not-a-signature')).toBe(
      false,
    );
  });
});
