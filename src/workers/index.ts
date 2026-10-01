import { prisma } from '../config/db';
import { logger } from '../config/logger';
import { closeSubscriptionRoutingCache } from '../cache';
import {
  closeSubscriptionConcurrency,
  waitForSubscriptionConcurrency,
} from '../api/modules/delivery/delivery.concurrency';
import { deliveryDeadLetterQueue } from '../queues/delivery-dead-letter.queue';
import { deliveryQueue } from '../queues/delivery.queue';
import { deliveryWorker } from './delivery/delivery.worker';
import {
  recoverInterruptedEventFanout,
  startEventFanoutPoller,
  stopEventFanoutPoller,
} from './fanout/fanout.processor';
import { startOutboxPoller, stopOutboxPoller } from './outbox/poller';

const workerLogger = logger.child({ component: 'workers' });

const closeInfrastructure = async () => {
  await Promise.all([stopEventFanoutPoller(), stopOutboxPoller()]);
  await deliveryWorker.close();
  await Promise.all([
    deliveryQueue.close(),
    deliveryDeadLetterQueue.close(),
    closeSubscriptionRoutingCache(),
    closeSubscriptionConcurrency(),
    prisma.$disconnect(),
  ]);
};

const start = async () => {
  deliveryQueue.on('error', (error) => {
    workerLogger.error({ err: error, queue: 'delivery' }, 'Delivery queue error');
  });
  deliveryDeadLetterQueue.on('error', (error) => {
    workerLogger.error({ err: error, queue: 'delivery-dead-letter' }, 'Dead-letter queue error');
  });
  deliveryWorker.on('error', (error) => {
    workerLogger.error({ err: error }, 'Delivery worker error');
  });

  try {
    await Promise.all([
      deliveryQueue.waitUntilReady(),
      deliveryDeadLetterQueue.waitUntilReady(),
      deliveryWorker.waitUntilReady(),
      waitForSubscriptionConcurrency(),
    ]);

    const recovered = await recoverInterruptedEventFanout();
    if (recovered.count > 0) {
      workerLogger.warn({ recoveredCount: recovered.count }, 'Recovered interrupted event fan-out');
    }
  } catch (error) {
    workerLogger.fatal({ err: error }, 'Failed to start workers');
    await closeInfrastructure();
    process.exitCode = 1;
    return;
  }

  startOutboxPoller();
  startEventFanoutPoller();
  workerLogger.info('Pigeon workers started: delivery, outbox, and event fan-out');

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    workerLogger.info({ signal }, 'Shutdown signal received');

    try {
      await closeInfrastructure();
    } catch (error) {
      workerLogger.error({ err: error }, 'Failed to close worker infrastructure');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

void start().catch((error: unknown) => {
  workerLogger.fatal({ err: error }, 'Failed to start Pigeon workers');
  closeInfrastructure()
    .catch((infrastructureError: unknown) => {
      workerLogger.error({ err: infrastructureError }, 'Failed to close worker infrastructure');
    })
    .finally(() => {
      process.exitCode = 1;
    });
});
