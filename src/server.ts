import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './db';
import { deliveryDeadLetterQueue, deliveryQueue } from './queue';
import {
  startDeadLetterOutboxPublisher,
  stopDeadLetterOutboxPublisher,
} from './services/delivery-dead-letter-outbox-service';
import {
  startDeliveryOutboxPublisher,
  stopDeliveryOutboxPublisher,
} from './services/delivery-outbox-service';
import {
  closeSubscriptionConcurrency,
  waitForSubscriptionConcurrency,
} from './services/subscription-concurrency-service';
import { deliveryWorker } from './workers';

const serverLogger = logger.child({ component: 'server' });

const closeInfrastructure = async () => {
  await Promise.all([stopDeliveryOutboxPublisher(), stopDeadLetterOutboxPublisher()]);
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
    serverLogger.error({ err: error, queue: 'delivery' }, 'Delivery queue error');
  });
  deliveryDeadLetterQueue.on('error', (error) => {
    serverLogger.error({ err: error, queue: 'delivery-dead-letter' }, 'Delivery queue error');
  });
  deliveryWorker.on('error', (error) => {
    serverLogger.error({ err: error }, 'Delivery worker error');
  });

  try {
    await Promise.all([
      deliveryQueue.waitUntilReady(),
      deliveryDeadLetterQueue.waitUntilReady(),
      deliveryWorker.waitUntilReady(),
      waitForSubscriptionConcurrency(),
    ]);
  } catch (error) {
    serverLogger.fatal({ err: error }, 'Failed to connect to Redis');
    await closeInfrastructure();
    process.exitCode = 1;
    return;
  }

  startDeliveryOutboxPublisher();
  startDeadLetterOutboxPublisher();

  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    serverLogger.info({ host: env.HOST, port: env.PORT }, 'Pigeon HTTP server listening');
  });

  server.on('error', (error) => {
    serverLogger.fatal({ err: error }, 'HTTP server error');
    process.exitCode = 1;
  });

  let isShuttingDown = false;

  const shutdown = (signal: string) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    serverLogger.info({ signal }, 'Shutdown signal received');
    server.close(async (error) => {
      if (error) {
        serverLogger.error({ err: error }, 'Failed to close HTTP server');
        process.exitCode = 1;
      }

      try {
        await closeInfrastructure();
      } catch (infrastructureError) {
        serverLogger.error(
          { err: infrastructureError },
          'Failed to close infrastructure connections',
        );
        process.exitCode = 1;
      }
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
};

void start().catch((error: unknown) => {
  serverLogger.fatal({ err: error }, 'Failed to start Pigeon');
  closeInfrastructure()
    .catch((infrastructureError: unknown) => {
      serverLogger.error(
        { err: infrastructureError },
        'Failed to close infrastructure connections',
      );
    })
    .finally(() => {
      process.exitCode = 1;
    });
});
