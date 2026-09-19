import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './db';
import { deliveryDeadLetterQueue, deliveryQueue } from './queue';
import { closeApiKeyCache } from './services/api-key-cache-service';
import { closeSubscriptionRoutingCache } from './services/subscription-routing-cache-service';

const apiLogger = logger.child({ component: 'api' });

const closeInfrastructure = async () => {
  await Promise.all([
    deliveryQueue.close(),
    deliveryDeadLetterQueue.close(),
    closeApiKeyCache(),
    closeSubscriptionRoutingCache(),
    prisma.$disconnect(),
  ]);
};

const start = async () => {
  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    apiLogger.info({ host: env.HOST, port: env.PORT }, 'Pigeon API listening');
  });

  server.on('error', (error) => {
    apiLogger.fatal({ err: error }, 'HTTP server error');
    process.exitCode = 1;
  });

  let isShuttingDown = false;

  const shutdown = (signal: string) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    apiLogger.info({ signal }, 'Shutdown signal received');
    server.close(async (error) => {
      if (error) {
        apiLogger.error({ err: error }, 'Failed to close HTTP server');
        process.exitCode = 1;
      }

      try {
        await closeInfrastructure();
      } catch (infrastructureError) {
        apiLogger.error(
          { err: infrastructureError },
          'Failed to close API infrastructure connections',
        );
        process.exitCode = 1;
      }
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
};

void start().catch((error: unknown) => {
  apiLogger.fatal({ err: error }, 'Failed to start Pigeon API');
  closeInfrastructure()
    .catch((infrastructureError: unknown) => {
      apiLogger.error(
        { err: infrastructureError },
        'Failed to close API infrastructure connections',
      );
    })
    .finally(() => {
      process.exitCode = 1;
    });
});
