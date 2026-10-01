import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { publishDeadLetterOutboxEntries } from './dead-letter-outbox.publisher';
import { publishDeliveryOutboxEntries } from './delivery-outbox.publisher';

const outboxLogger = logger.child({ component: 'outbox-poller' });

let timer: NodeJS.Timeout | undefined;
let deliveryPublishInFlight: Promise<void> | undefined;
let deadLetterPublishInFlight: Promise<void> | undefined;

const publishDeliveryOutboxSafely = () => {
  if (deliveryPublishInFlight) {
    return deliveryPublishInFlight;
  }

  deliveryPublishInFlight = publishDeliveryOutboxEntries()
    .catch((error: unknown) => {
      outboxLogger.error({ err: error }, 'Failed to publish delivery outbox entries');
    })
    .finally(() => {
      deliveryPublishInFlight = undefined;
    });

  return deliveryPublishInFlight;
};

const publishDeadLetterOutboxSafely = () => {
  if (deadLetterPublishInFlight) {
    return deadLetterPublishInFlight;
  }

  deadLetterPublishInFlight = publishDeadLetterOutboxEntries()
    .catch((error: unknown) => {
      outboxLogger.error({ err: error }, 'Failed to publish dead-letter outbox entries');
    })
    .finally(() => {
      deadLetterPublishInFlight = undefined;
    });

  return deadLetterPublishInFlight;
};

const poll = () => {
  void publishDeliveryOutboxSafely();
  void publishDeadLetterOutboxSafely();
};

export const startOutboxPoller = () => {
  if (timer) {
    return;
  }

  poll();
  timer = setInterval(poll, env.DELIVERY_OUTBOX_POLL_INTERVAL_MS);
};

export const stopOutboxPoller = async () => {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }

  await Promise.all([deliveryPublishInFlight, deadLetterPublishInFlight]);
};
