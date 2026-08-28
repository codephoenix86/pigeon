import { createApp } from './app';
import { env } from './config/env';

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  console.info(`Webhook Dispatcher listening on http://${env.HOST}:${env.PORT}`);
});

server.on('error', (error) => {
  console.error('Failed to start HTTP server', error);
  process.exitCode = 1;
});

const shutdown = (signal: string) => {
  console.info(`${signal} received; shutting down`);
  server.close((error) => {
    if (error) {
      console.error('Failed to close HTTP server', error);
      process.exitCode = 1;
    }
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
