import { logger } from '../config/logger';
import { prisma } from '../db';
import { createClient } from '../services/client-service';

const run = async () => {
  const { apiKey, client } = await createClient();

  // This is an explicit provisioning command, the sole intentional exposure of
  // this credential. Application request logging never includes API keys.
  process.stdout.write(`Client ID: ${client.id}\n`);
  process.stdout.write(`API key (save it now; it will not be shown again): ${apiKey}\n`);
};

run()
  .catch((error: unknown) => {
    logger.error({ err: error, component: 'client-provisioning' }, 'Failed to provision client');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
