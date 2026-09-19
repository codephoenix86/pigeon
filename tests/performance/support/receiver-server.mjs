import express from 'express';

const host = process.env.PERFORMANCE_SERVER_HOST ?? '127.0.0.1';
const port = Number(process.env.PERFORMANCE_SERVER_PORT ?? 4000);
const failureRate = Number(process.env.PERFORMANCE_RECEIVER_FAILURE_RATE ?? 0.4);
const responseDelayMs = Number(process.env.PERFORMANCE_RECEIVER_DELAY_MS ?? 0);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PERFORMANCE_SERVER_PORT must be a valid TCP port.');
}

if (!Number.isFinite(failureRate) || failureRate < 0 || failureRate > 1) {
  throw new Error('PERFORMANCE_RECEIVER_FAILURE_RATE must be a number from 0 through 1.');
}

if (!Number.isInteger(responseDelayMs) || responseDelayMs < 0 || responseDelayMs > 60_000) {
  throw new Error('PERFORMANCE_RECEIVER_DELAY_MS must be an integer from 0 through 60000.');
}

const app = express();
let requestCount = 0;

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok', requestCount });
});

app.post('/webhooks', async (_request, response) => {
  requestCount += 1;

  if (responseDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
  }

  if (Math.random() < failureRate) {
    response.sendStatus(503);
    return;
  }

  response.sendStatus(204);
});

const server = app.listen(port, host, () => {
  console.log(
    `Performance receiver listening on http://${host}:${port}/webhooks (failure rate: ${failureRate * 100}%, delay: ${responseDelayMs}ms)`,
  );
});

const shutdown = () => {
  server.close((error) => {
    if (error) {
      console.error('Failed to stop performance receiver:', error);
      process.exitCode = 1;
    }
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
