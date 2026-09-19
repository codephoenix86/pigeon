import { logger } from './config/logger';
import { prisma } from './db';
import { deliveryDeadLetterQueue, deliveryQueue } from './queue';
import {
  startDeadLetterOutboxPublisher,
  stopDeadLetterOutboxPublisher,
} from './services/delivery-dead-letter-outbox-service';
import {
  closeSubscriptionConcurrency,
  waitForSubscriptionConcurrency,
} from './services/subscription-concurrency-service';
import { deliveryWorker } from './workers';

const workerLogger = logger.child({ component: 'worker' });

const closeInfrastructure = async () => {
  await stopDeadLetterOutboxPublisher();
  await deliveryWorker.close();
  await Promise.all([
    deliveryQueue.close(),
    deliveryDeadLetterQueue.close(),
    closeSubscriptionConcurrency(),
    prisma.$disconnect(),
  ]);
};

const start = async () => {
  deliveryQueue.on('error', (error) => {
    workerLogger.error({ err: error, queue: 'delivery' }, 'Delivery queue error');
  });
  deliveryDeadLetterQueue.on('error', (error) => {
    workerLogger.error({ err: error, queue: 'delivery-dead-letter' }, 'Delivery queue error');
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
  } catch (error) {
    workerLogger.fatal({ err: error }, 'Failed to connect worker to Redis');
    await closeInfrastructure();
    process.exitCode = 1;
    return;
  }

  startDeadLetterOutboxPublisher();
  workerLogger.info('Pigeon delivery worker listening for jobs');

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
      workerLogger.error({ err: error }, 'Failed to close worker infrastructure connections');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

void start().catch((error: unknown) => {
  workerLogger.fatal({ err: error }, 'Failed to start Pigeon worker');
  closeInfrastructure()
    .catch((infrastructureError: unknown) => {
      workerLogger.error(
        { err: infrastructureError },
        'Failed to close worker infrastructure connections',
      );
    })
    .finally(() => {
      process.exitCode = 1;
    });
});
