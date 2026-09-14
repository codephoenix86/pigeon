import { describe, expect, it } from 'vitest';

import { calculateDeliveryBackoff } from '../../src/services/delivery-backoff';

describe('calculateDeliveryBackoff', () => {
  it.each([
    [1, 60_000],
    [2, 5 * 60_000],
    [3, 30 * 60_000],
    [4, 2 * 60 * 60_000],
    [5, 12 * 60 * 60_000],
  ])('uses the configured retry delay for attempt %i', (attemptsMade, expectedDelay) => {
    expect(calculateDeliveryBackoff(attemptsMade, 0.5, 0.2)).toBe(expectedDelay);
  });

  it('caps later attempts at the maximum delay', () => {
    expect(calculateDeliveryBackoff(100, 0.5, 0.2)).toBe(12 * 60 * 60_000);
  });

  it('uses the first delay for an out-of-range attempt number', () => {
    expect(calculateDeliveryBackoff(0, 0.5, 0.2)).toBe(60_000);
  });

  it.each([
    [0, 48_000],
    [0.5, 60_000],
    [1, 72_000],
  ])('applies bounded symmetric jitter for random value %s', (jitterValue, expectedDelay) => {
    expect(calculateDeliveryBackoff(1, jitterValue, 0.2)).toBe(expectedDelay);
  });

  it('clamps jitter inputs outside the expected random range', () => {
    expect(calculateDeliveryBackoff(1, -1, 0.2)).toBe(48_000);
    expect(calculateDeliveryBackoff(1, 2, 0.2)).toBe(72_000);
  });
});
