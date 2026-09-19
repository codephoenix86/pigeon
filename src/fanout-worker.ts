import { logger } from './config/logger';
import { prisma } from './db';
import {
  recoverInterruptedEventFanout,
  startEventFanoutPoller,
  stopEventFanoutPoller,
} from './services/event-fanout-service';
import { closeSubscriptionRoutingCache } from './services/subscription-routing-cache-service';

const workerLogger = logger.child({ component: 'event-fanout-worker' });

const closeInfrastructure = async () => {
  await stopEventFanoutPoller();
  await Promise.all([closeSubscriptionRoutingCache(), prisma.$disconnect()]);
};

const start = async () => {
  const recovered = await recoverInterruptedEventFanout();
  if (recovered.count > 0) {
    workerLogger.warn({ recoveredCount: recovered.count }, 'Recovered interrupted event fan-out');
  }
  startEventFanoutPoller();
  workerLogger.info('Pigeon event fan-out worker is polling events');

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    workerLogger.info({ signal }, 'Shutdown signal received');

    try {
      await closeInfrastructure();
    } catch (error) {
      workerLogger.error({ err: error }, 'Failed to close event fan-out worker infrastructure');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

void start().catch((error: unknown) => {
  workerLogger.fatal({ err: error }, 'Failed to start event fan-out worker');
  closeInfrastructure()
    .catch((infrastructureError: unknown) => {
      workerLogger.error(
        { err: infrastructureError },
        'Failed to close event fan-out worker infrastructure',
      );
    })
    .finally(() => {
      process.exitCode = 1;
    });
});
