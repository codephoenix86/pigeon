import { prisma } from '../db';
import { createClient } from '../services/client-service';

const run = async () => {
  const { apiKey, client } = await createClient();

  // This is an explicit provisioning command, the sole intentional exposure of
  // this credential. Application request logging never includes API keys.
  console.info(`Client ID: ${client.id}`);
  console.info(`API key (save it now; it will not be shown again): ${apiKey}`);
};

run()
  .catch((error: unknown) => {
    console.error('Failed to provision client.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
