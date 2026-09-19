import { logger } from './config/logger';
import { prisma } from './db';
import { deliveryQueue } from './queue';
import {
  startDeliveryOutboxPublisher,
  stopDeliveryOutboxPublisher,
} from './services/delivery-outbox-service';

const outboxWorkerLogger = logger.child({ component: 'delivery-outbox-worker' });

const closeInfrastructure = async () => {
  await stopDeliveryOutboxPublisher();
  await Promise.all([deliveryQueue.close(), prisma.$disconnect()]);
};

const start = async () => {
  deliveryQueue.on('error', (error) => {
    outboxWorkerLogger.error({ err: error, queue: 'delivery' }, 'Delivery queue error');
  });

  try {
    await deliveryQueue.waitUntilReady();
  } catch (error) {
    outboxWorkerLogger.fatal({ err: error }, 'Failed to connect delivery outbox worker to Redis');
    await closeInfrastructure();
    process.exitCode = 1;
    return;
  }

  startDeliveryOutboxPublisher();
  outboxWorkerLogger.info('Pigeon delivery outbox worker is publishing entries');

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    outboxWorkerLogger.info({ signal }, 'Shutdown signal received');

    try {
      await closeInfrastructure();
    } catch (error) {
      outboxWorkerLogger.error({ err: error }, 'Failed to close outbox worker infrastructure');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

void start().catch((error: unknown) => {
  outboxWorkerLogger.fatal({ err: error }, 'Failed to start delivery outbox worker');
  closeInfrastructure()
    .catch((infrastructureError: unknown) => {
      outboxWorkerLogger.error(
        { err: infrastructureError },
        'Failed to close outbox worker infrastructure',
      );
    })
    .finally(() => {
      process.exitCode = 1;
    });
});
