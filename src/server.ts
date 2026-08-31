import { createApp } from './app';
import { env } from './config/env';
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
import { deliveryWorker } from './workers';

const closeInfrastructure = async () => {
  await Promise.all([stopDeliveryOutboxPublisher(), stopDeadLetterOutboxPublisher()]);
  await deliveryWorker.close();
  await Promise.all([deliveryQueue.close(), deliveryDeadLetterQueue.close(), prisma.$disconnect()]);
};

const start = async () => {
  deliveryQueue.on('error', (error) => {
    console.error('Delivery queue error', error);
  });
  deliveryDeadLetterQueue.on('error', (error) => {
    console.error('Delivery dead-letter queue error', error);
  });
  deliveryWorker.on('error', (error) => {
    console.error('Delivery worker error', error);
  });

  try {
    await Promise.all([
      deliveryQueue.waitUntilReady(),
      deliveryDeadLetterQueue.waitUntilReady(),
      deliveryWorker.waitUntilReady(),
    ]);
  } catch (error) {
    console.error('Failed to connect to Redis', error);
    await closeInfrastructure();
    process.exitCode = 1;
    return;
  }

  startDeliveryOutboxPublisher();
  startDeadLetterOutboxPublisher();

  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    console.info(`Pigeon listening on http://${env.HOST}:${env.PORT}`);
  });

  server.on('error', (error) => {
    console.error('Failed to start HTTP server', error);
    process.exitCode = 1;
  });

  let isShuttingDown = false;

  const shutdown = (signal: string) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.info(`${signal} received; shutting down`);
    server.close(async (error) => {
      if (error) {
        console.error('Failed to close HTTP server', error);
        process.exitCode = 1;
      }

      try {
        await closeInfrastructure();
      } catch (infrastructureError) {
        console.error('Failed to close infrastructure connections', infrastructureError);
        process.exitCode = 1;
      }
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
};

void start().catch((error: unknown) => {
  console.error('Failed to start Pigeon', error);
  closeInfrastructure()
    .catch((infrastructureError: unknown) => {
      console.error('Failed to close infrastructure connections', infrastructureError);
    })
    .finally(() => {
      process.exitCode = 1;
    });
});
